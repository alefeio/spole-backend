import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { AppError } from "../errors/app-error";

const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export type IdempotentHandlerResult<T> = {
  status: number;
  data: T;
  meta?: Record<string, unknown>;
};

type StoredIdempotency = {
  id: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
  request_hash: string;
};

export function getIdempotencyKey(req: Request): string | undefined {
  const raw = req.get(IDEMPOTENCY_HEADER)?.trim();
  if (!raw || raw.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(raw)) {
    return undefined;
  }
  return raw;
}

export function buildRequestHash(req: Request, routeTemplate: string): string {
  const payload = {
    route: routeTemplate,
    params: req.params,
    query: req.query,
    body: req.body ?? null
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function findIdempotencyRecord(
  pool: Pool,
  userId: string,
  method: string,
  route: string,
  key: string
): Promise<StoredIdempotency | null> {
  const res = await pool.query<StoredIdempotency>(
    `
      SELECT id, status::text, response_status, response_body, request_hash
      FROM idempotency_keys
      WHERE user_id = $1 AND method = $2 AND route = $3 AND idempotency_key = $4
        AND expires_at > now()
      LIMIT 1
    `,
    [userId, method, route, key]
  );
  return res.rows[0] ?? null;
}

async function insertProcessing(
  pool: Pool,
  input: {
    userId: string;
    key: string;
    method: string;
    route: string;
    requestHash: string;
    ttlSeconds: number;
  }
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `
      INSERT INTO idempotency_keys (
        user_id, idempotency_key, method, route, request_hash, status, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, 'PROCESSING', now() + ($6::int * interval '1 second'))
      RETURNING id
    `,
    [input.userId, input.key, input.method, input.route, input.requestHash, input.ttlSeconds]
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new AppError({ status: 500, code: "IDEMPOTENCY_RESERVE_FAILED", message: "Idempotency reserve failed" });
  }
  return id;
}

async function completeIdempotency(
  pool: Pool,
  id: string,
  status: number,
  body: unknown,
  resourceType?: string,
  resourceId?: string
) {
  await pool.query(
    `
      UPDATE idempotency_keys
      SET
        status = 'COMPLETED',
        response_status = $2,
        response_body = $3,
        resource_type = $4,
        resource_id = $5,
        completed_at = now()
      WHERE id = $1
    `,
    [id, status, body, resourceType ?? null, resourceId ?? null]
  );
}

async function deleteProcessing(pool: Pool, id: string) {
  await pool.query(`DELETE FROM idempotency_keys WHERE id = $1 AND status = 'PROCESSING'`, [id]);
}

function replayStored(res: Response, row: StoredIdempotency) {
  const status = row.response_status ?? 200;
  const body = row.response_body as { success?: boolean; data?: unknown; meta?: Record<string, unknown> };
  if (body && typeof body === "object" && body.success === true && "data" in body) {
    return sendSuccess(res, body.data as never, body.meta, status);
  }
  return res.status(status).json(body);
}

function extractResourceId(data: unknown): { type?: string; id?: string } {
  if (!data || typeof data !== "object") return {};
  const row = data as Record<string, unknown>;
  if (typeof row.id === "string") {
    if (typeof row.bookingId === "string") return { type: "BOOKING", id: row.bookingId };
    if (typeof row.reservationId === "string") return { type: "RESERVATION", id: row.reservationId };
    if (typeof row.reservationOccurrenceId === "string") {
      return { type: "RESERVATION_OCCURRENCE", id: row.reservationOccurrenceId };
    }
    return { type: "RESOURCE", id: row.id };
  }
  return {};
}

export async function runWithIdempotency<T>(
  deps: AppDeps,
  req: Request,
  res: Response,
  input: {
    method: string;
    routeTemplate: string;
    userId: string;
    execute: () => Promise<IdempotentHandlerResult<T>>;
  }
): Promise<void> {
  const key = getIdempotencyKey(req);
  if (!key) {
    const result = await input.execute();
    sendSuccess(res, result.data, result.meta, result.status);
    return;
  }

  const requestHash = buildRequestHash(req, input.routeTemplate);
  const existing = await findIdempotencyRecord(
    deps.pool,
    input.userId,
    input.method,
    input.routeTemplate,
    key
  );

  if (existing?.status === "COMPLETED") {
    if (existing.request_hash !== requestHash) {
      sendFailure(res, 409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different request");
      return;
    }
    replayStored(res, existing);
    return;
  }

  if (existing?.status === "PROCESSING") {
    sendFailure(res, 409, "IDEMPOTENCY_IN_PROGRESS", "Request with this idempotency key is still processing");
    return;
  }

  if (existing && existing.request_hash !== requestHash) {
    sendFailure(res, 409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different request");
    return;
  }

  let recordId: string;
  try {
    recordId = await insertProcessing(deps.pool, {
      userId: input.userId,
      key,
      method: input.method,
      route: input.routeTemplate,
      requestHash,
      ttlSeconds: deps.env.idempotencyTtlSeconds
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      const again = await findIdempotencyRecord(
        deps.pool,
        input.userId,
        input.method,
        input.routeTemplate,
        key
      );
      if (again?.status === "COMPLETED") {
        replayStored(res, again);
        return;
      }
      sendFailure(res, 409, "IDEMPOTENCY_IN_PROGRESS", "Request with this idempotency key is still processing");
      return;
    }
    throw err;
  }

  try {
    const result = await input.execute();
    const payload = result.meta
      ? { success: true as const, data: result.data, meta: result.meta }
      : { success: true as const, data: result.data };
    const resource = extractResourceId(result.data);
    await completeIdempotency(
      deps.pool,
      recordId,
      result.status,
      payload,
      resource.type,
      resource.id
    );
    sendSuccess(res, result.data, result.meta, result.status);
  } catch (err) {
    await deleteProcessing(deps.pool, recordId);
    throw err;
  }
}
