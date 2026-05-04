import type { Pool, PoolClient } from "pg";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import type { AuthUser } from "../../types/auth";
import { canAccessEventDetail, type DbEvent } from "../events/service";
import { bookingRedisKey } from "./booking-redis";

type PgConn = Pool | PoolClient;

export async function expireStaleBookings(
  conn: PgConn,
  redis: AppDeps["redis"],
  filters: { eventId?: string; userId?: string }
): Promise<void> {
  const conditions = [`status = 'RESERVED'`, `expires_at <= now()`];
  const params: unknown[] = [];
  let i = 1;
  if (filters.eventId) {
    conditions.push(`event_id = $${i++}`);
    params.push(filters.eventId);
  }
  if (filters.userId) {
    conditions.push(`user_id = $${i++}`);
    params.push(filters.userId);
  }
  const res = await conn.query<{ id: string }>(
    `
      UPDATE bookings
      SET status = 'EXPIRED', updated_at = now()
      WHERE ${conditions.join(" AND ")}
      RETURNING id
    `,
    params
  );
  for (const row of res.rows) {
    await redis.del(bookingRedisKey(row.id)).catch(() => undefined);
  }
}

async function countUsedSpots(conn: PgConn, eventId: string): Promise<number> {
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

async function hasActiveReservedBooking(conn: PgConn, eventId: string, userId: string): Promise<boolean> {
  const r = await conn.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE event_id = $1 AND user_id = $2 AND status = 'RESERVED'
      ) AS exists
    `,
    [eventId, userId]
  );
  return Boolean(r.rows[0]?.exists);
}

function assertPaidEventForBooking(row: DbEvent) {
  if (row.status !== "PUBLISHED") {
    throw new AppError({
      status: 422,
      code: "EVENT_NOT_OPEN_FOR_BOOKING",
      message: "Event is not open for bookings"
    });
  }
  if (row.type !== "PAID") {
    throw new AppError({
      status: 422,
      code: "EVENT_NOT_PAID",
      message: "Bookings are only available for paid events"
    });
  }
}

export async function createPaidBooking(
  deps: AppDeps,
  auth: AuthUser,
  eventId: string,
  privateCode: string | undefined
) {
  const { pool, redis, env } = deps;
  const ttl = env.bookingTtlSeconds;

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

    assertPaidEventForBooking(row);

    if (await hasActiveReservedBooking(client, eventId, auth.id)) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "BOOKING_CONFLICT",
        message: "You already have an active booking for this event"
      });
    }

    const used = await countUsedSpots(client, eventId);
    if (used >= row.capacity) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 409, code: "EVENT_FULL", message: "No spots available for this event" });
    }

    const ins = await client.query<{ id: string; expires_at: string }>(
      `
        INSERT INTO bookings (event_id, user_id, status, reserved_at, expires_at, redis_key)
        VALUES ($1, $2, 'RESERVED', now(), now() + interval '1 second' * $3::int, NULL)
        RETURNING id, expires_at
      `,
      [eventId, auth.id, ttl]
    );
    const created = ins.rows[0];
    if (!created) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "BOOKING_CREATE_FAILED", message: "Booking create failed" });
    }

    const rkey = bookingRedisKey(created.id);
    await client.query(`UPDATE bookings SET redis_key = $2 WHERE id = $1`, [created.id, rkey]);

    await client.query("COMMIT");

    try {
      await redis.setEx(rkey, ttl, created.id);
    } catch {
      await pool.query(
        `
          UPDATE bookings
          SET status = 'CANCELLED', updated_at = now()
          WHERE id = $1 AND status = 'RESERVED'
        `,
        [created.id]
      );
      await redis.del(rkey).catch(() => undefined);
      throw new AppError({
        status: 500,
        code: "REDIS_UNAVAILABLE",
        message: "Temporary hold could not be created; try again later"
      });
    }

    return {
      id: created.id,
      eventId,
      userId: auth.id,
      status: "RESERVED" as const,
      expiresAt: created.expires_at
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "BOOKING_CONFLICT",
        message: "Booking conflict for this event"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelBooking(deps: AppDeps, bookingId: string, auth: AuthUser) {
  const { pool, redis } = deps;

  const snap = await pool.query<{ id: string; event_id: string; user_id: string; status: string }>(
    `SELECT id, event_id, user_id, status::text FROM bookings WHERE id = $1`,
    [bookingId]
  );
  const b0 = snap.rows[0];
  if (!b0) {
    throw new AppError({ status: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
  }
  if (auth.role !== "admin" && b0.user_id !== auth.id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  await expireStaleBookings(pool, redis, { eventId: b0.event_id });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bRes = await client.query<{ status: string }>(
      `SELECT status::text FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    const st = bRes.rows[0]?.status;
    if (st === "CANCELLED") {
      await client.query("COMMIT");
      return { id: bookingId, status: "CANCELLED" as const };
    }
    if (st !== "RESERVED") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "BOOKING_NOT_CANCELLABLE",
        message: "Booking cannot be cancelled in its current state"
      });
    }

    await client.query(
      `
        UPDATE bookings
        SET status = 'CANCELLED', updated_at = now()
        WHERE id = $1
      `,
      [bookingId]
    );

    await client.query("COMMIT");

    const rk = bookingRedisKey(bookingId);
    await redis.del(rk).catch(() => undefined);

    return { id: bookingId, status: "CANCELLED" as const };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyBookings(deps: AppDeps, auth: AuthUser) {
  await expireStaleBookings(deps.pool, deps.redis, { userId: auth.id });
  const res = await deps.pool.query<{
    id: string;
    event_id: string;
    user_id: string;
    status: string;
    reserved_at: string;
    expires_at: string;
  }>(
    `
      SELECT id, event_id, user_id, status::text, reserved_at, expires_at
      FROM bookings
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
    reservedAt: r.reserved_at,
    expiresAt: r.expires_at
  }));
}
