import type { PoolClient } from "pg";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import type { AuthUser } from "../../types/auth";
import { expireStaleBookings } from "../bookings/service";
import { canAccessEventDetail, loadEvent, type DbEvent } from "../events/service";

async function countUsedSpots(conn: PoolClient, eventId: string): Promise<number> {
  const r = await conn.query<{ c: string }>(
    `
      SELECT (
        (SELECT COUNT(*)::int FROM event_participants WHERE event_id = $1 AND status = 'CONFIRMED')
        +
        (SELECT COUNT(*)::int FROM bookings WHERE event_id = $1 AND status = 'RESERVED')
      )::text AS c
    `,
    [eventId]
  );
  return Number(r.rows[0]?.c ?? 0);
}

function assertFreeEventForJoin(row: DbEvent) {
  if (row.status !== "PUBLISHED") {
    throw new AppError({
      status: 422,
      code: "EVENT_NOT_OPEN_FOR_JOIN",
      message: "Event is not open for registration"
    });
  }
  if (row.type !== "FREE") {
    throw new AppError({
      status: 422,
      code: "EVENT_NOT_FREE",
      message: "This endpoint is only for free events"
    });
  }
}

export async function joinFreeEvent(
  deps: AppDeps,
  auth: AuthUser,
  eventId: string,
  privateCode: string | undefined
) {
  const { pool, redis } = deps;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await expireStaleBookings(client, redis, { eventId });

    const evRes = await client.query<DbEvent>(
      `
        SELECT
          id, organizer_id, category_id, title, description, type::text, visibility::text,
          source_type::text, status::text, start_at, end_at, address_name, street, number,
          district, city, state, capacity, price_per_person::text, private_code, reservation_id
        FROM events
        WHERE id = $1
        FOR UPDATE
      `,
      [eventId]
    );
    const row = evRes.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
    }

    if (!canAccessEventDetail(row, auth, privateCode)) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 403, code: "FORBIDDEN", message: "You do not have access to this event" });
    }

    assertFreeEventForJoin(row);

    const used = await countUsedSpots(client, eventId);
    if (used >= row.capacity) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 409, code: "EVENT_FULL", message: "No spots available for this event" });
    }

    const ins = await client.query<{ id: string; event_id: string; user_id: string; status: string }>(
      `
        INSERT INTO event_participants (event_id, user_id, status)
        VALUES ($1, $2, 'CONFIRMED')
        RETURNING id, event_id, user_id, status::text
      `,
      [eventId, auth.id]
    );
    const created = ins.rows[0];
    if (!created) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "JOIN_FAILED", message: "Registration failed" });
    }

    await client.query("COMMIT");
    return {
      id: created.id,
      eventId: created.event_id,
      userId: created.user_id,
      status: created.status
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "ALREADY_REGISTERED",
        message: "User is already registered for this event"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyParticipants(deps: AppDeps, auth: AuthUser) {
  const res = await deps.pool.query<{
    id: string;
    event_id: string;
    user_id: string;
    status: string;
    created_at: string;
  }>(
    `
      SELECT id, event_id, user_id, status::text, created_at
      FROM event_participants
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [auth.id]
  );
  return res.rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    status: r.status,
    createdAt: r.created_at
  }));
}

export async function listEventParticipants(deps: AppDeps, eventId: string, auth: AuthUser) {
  const row = await loadEvent(deps.pool, eventId);
  if (!row) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }
  if (auth.role !== "admin" && auth.id !== row.organizer_id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  await expireStaleBookings(deps.pool, deps.redis, { eventId });

  const res = await deps.pool.query<{
    id: string;
    event_id: string;
    user_id: string;
    status: string;
    created_at: string;
  }>(
    `
      SELECT id, event_id, user_id, status::text, created_at
      FROM event_participants
      WHERE event_id = $1
      ORDER BY created_at ASC
    `,
    [eventId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    status: r.status,
    createdAt: r.created_at
  }));
}
