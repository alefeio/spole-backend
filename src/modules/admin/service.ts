import type { Pool, QueryResultRow } from "pg";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import type { PaginationMeta, PaginationQuery } from "../../shared/http/pagination";
import type { AuthUser, UserStatus } from "../../types/auth";
import { cancelEvent } from "../events/service";
import { AuditAction, insertAuditLog } from "./audit";
import type {
  adminArenasListQuerySchema,
  adminAuditLogsListQuerySchema,
  adminBookingsListQuerySchema,
  adminEventsListQuerySchema,
  adminPaymentsListQuerySchema,
  adminReservationsListQuerySchema,
  adminUsersListQuerySchema,
  patchArenaStatusSchema,
  patchEventStatusSchema,
  patchUserStatusSchema
} from "./schemas";
import type { z } from "zod";

const USER_TRANSITIONS: Record<UserStatus, UserStatus[]> = {
  ACTIVE: ["SUSPENDED", "INACTIVE"],
  SUSPENDED: ["ACTIVE"],
  INACTIVE: ["ACTIVE"]
};

function assertNotSelf(actorId: string, targetId: string) {
  if (actorId === targetId) {
    throw new AppError({
      status: 422,
      code: "ADMIN_CANNOT_MODIFY_SELF",
      message: "Admin cannot perform this action on own account"
    });
  }
}

async function paginatedQuery<T extends QueryResultRow>(
  pool: Pool,
  countSql: string,
  dataSql: string,
  params: unknown[],
  query: PaginationQuery,
  mapRow: (row: T) => unknown
) {
  const countRes = await pool.query<{ count: string }>(countSql, params);
  const total = Number(countRes.rows[0]?.count ?? 0);
  const offset = (query.page - 1) * query.limit;
  const dataRes = await pool.query<T>(dataSql, [...params, query.limit, offset]);
  return {
    data: dataRes.rows.map(mapRow),
    meta: { page: query.page, limit: query.limit, total } satisfies PaginationMeta
  };
}

export async function listAdminUsers(pool: Pool, query: z.infer<typeof adminUsersListQuerySchema>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.status) {
    conditions.push(`u.status = $${i++}::user_status`);
    params.push(query.status);
  }
  if (query.role) {
    conditions.push(`u.role = $${i++}::user_role`);
    params.push(query.role);
  }
  if (query.email) {
    conditions.push(`u.email ILIKE $${i++} ESCAPE '\\'`);
    params.push(`%${query.email.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `SELECT COUNT(*)::text AS count FROM users u ${where}`,
    `
      SELECT u.id, u.name, u.email, u.role::text, u.status::text, u.created_at
      FROM users u
      ${where}
      ORDER BY u.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: { id: string; name: string; email: string; role: string; status: string; created_at: string }) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      createdAt: r.created_at
    })
  );
}

export async function getAdminUserById(pool: Pool, userId: string) {
  const res = await pool.query<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    phone: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, name, email, role::text, status::text, phone, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError({ status: 404, code: "USER_NOT_FOUND", message: "User not found" });
  }

  const counts = await pool.query<{
    reservations: string;
    bookings: string;
    payments: string;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::text FROM reservations WHERE organizer_id = $1) AS reservations,
        (SELECT COUNT(*)::text FROM bookings WHERE user_id = $1) AS bookings,
        (SELECT COUNT(*)::text FROM payments WHERE user_id = $1) AS payments
    `,
    [userId]
  );
  const c = counts.rows[0];

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    counts: {
      reservations: Number(c?.reservations ?? 0),
      bookings: Number(c?.bookings ?? 0),
      payments: Number(c?.payments ?? 0)
    }
  };
}

export async function patchAdminUserStatus(
  pool: Pool,
  actor: AuthUser,
  userId: string,
  body: z.infer<typeof patchUserStatusSchema>
) {
  assertNotSelf(actor.id, userId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query<{ id: string; status: string }>(
      `SELECT id, status::text FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "USER_NOT_FOUND", message: "User not found" });
    }

    const fromStatus = row.status as UserStatus;
    const toStatus = body.status;
    const allowed = USER_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "INVALID_STATUS_TRANSITION",
        message: "Invalid user status transition"
      });
    }

    if (fromStatus === toStatus) {
      await client.query("COMMIT");
      return { id: row.id, status: toStatus };
    }

    await client.query(
      `UPDATE users SET status = $2::user_status, updated_at = now() WHERE id = $1`,
      [userId, toStatus]
    );

    await insertAuditLog(client, {
      actorUserId: actor.id,
      action: AuditAction.USER_STATUS_CHANGED,
      resourceType: "USER",
      resourceId: userId,
      reason: body.reason,
      metadata: { fromStatus, toStatus }
    });

    await client.query("COMMIT");
    return { id: userId, status: toStatus };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listAdminArenas(pool: Pool, query: z.infer<typeof adminArenasListQuerySchema>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.status) {
    conditions.push(`a.status = $${i++}::arena_status`);
    params.push(query.status);
  }
  if (query.ownerId) {
    conditions.push(`a.owner_id = $${i++}`);
    params.push(query.ownerId);
  }
  if (query.city) {
    conditions.push(`addr.city ILIKE $${i++} ESCAPE '\\'`);
    params.push(`%${query.city.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `
      SELECT COUNT(*)::text AS count
      FROM arenas a
      LEFT JOIN arena_addresses addr ON addr.arena_id = a.id
      ${where}
    `,
    `
      SELECT a.id, a.name, a.slug, a.status::text, a.owner_id, addr.city, a.created_at
      FROM arenas a
      LEFT JOIN arena_addresses addr ON addr.arena_id = a.id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: {
      id: string;
      name: string;
      slug: string;
      status: string;
      owner_id: string;
      city: string | null;
      created_at: string;
    }) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      ownerId: r.owner_id,
      city: r.city,
      createdAt: r.created_at
    })
  );
}

export async function patchAdminArenaStatus(
  pool: Pool,
  actor: AuthUser,
  arenaId: string,
  body: z.infer<typeof patchArenaStatusSchema>
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query<{ id: string; status: string }>(
      `SELECT id, status::text FROM arenas WHERE id = $1 FOR UPDATE`,
      [arenaId]
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "ARENA_NOT_FOUND", message: "Arena not found" });
    }

    const fromStatus = row.status;
    const toStatus = body.status;
    if (fromStatus === toStatus) {
      await client.query("COMMIT");
      return { id: row.id, status: toStatus };
    }

    if (!["ACTIVE", "INACTIVE"].includes(fromStatus) || !["ACTIVE", "INACTIVE"].includes(toStatus)) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "INVALID_STATUS_TRANSITION",
        message: "Invalid arena status transition"
      });
    }

    await client.query(
      `UPDATE arenas SET status = $2::arena_status, updated_at = now() WHERE id = $1`,
      [arenaId, toStatus]
    );

    await insertAuditLog(client, {
      actorUserId: actor.id,
      action: AuditAction.ARENA_STATUS_CHANGED,
      resourceType: "ARENA",
      resourceId: arenaId,
      reason: body.reason,
      metadata: { fromStatus, toStatus }
    });

    await client.query("COMMIT");
    return { id: arenaId, status: toStatus };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listAdminEvents(pool: Pool, query: z.infer<typeof adminEventsListQuerySchema>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.status) {
    conditions.push(`e.status = $${i++}::event_status`);
    params.push(query.status);
  }
  if (query.type) {
    conditions.push(`e.type = $${i++}::event_type`);
    params.push(query.type);
  }
  if (query.organizerId) {
    conditions.push(`e.organizer_id = $${i++}`);
    params.push(query.organizerId);
  }
  if (query.city) {
    conditions.push(`e.city ILIKE $${i++} ESCAPE '\\'`);
    params.push(`%${query.city.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `SELECT COUNT(*)::text AS count FROM events e ${where}`,
    `
      SELECT e.id, e.title, e.status::text, e.type::text, e.organizer_id, e.city, e.start_at, e.created_at
      FROM events e
      ${where}
      ORDER BY e.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: {
      id: string;
      title: string;
      status: string;
      type: string;
      organizer_id: string;
      city: string;
      start_at: string;
      created_at: string;
    }) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      type: r.type,
      organizerId: r.organizer_id,
      city: r.city,
      startAt: r.start_at,
      createdAt: r.created_at
    })
  );
}

export async function patchAdminEventStatus(
  deps: AppDeps,
  actor: AuthUser,
  eventId: string,
  body: z.infer<typeof patchEventStatusSchema>
) {
  if (body.status !== "CANCELLED") {
    throw new AppError({
      status: 422,
      code: "INVALID_EVENT_STATUS",
      message: "Only cancellation is supported"
    });
  }

  const before = await deps.pool.query<{ status: string }>(
    `SELECT status::text FROM events WHERE id = $1`,
    [eventId]
  );
  const fromStatus = before.rows[0]?.status;
  if (!fromStatus) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }

  const result = await cancelEvent(deps.pool, eventId, actor);

  if (fromStatus !== "CANCELLED") {
    await insertAuditLog(deps.pool, {
      actorUserId: actor.id,
      action: AuditAction.EVENT_STATUS_CHANGED,
      resourceType: "EVENT",
      resourceId: eventId,
      reason: body.reason,
      metadata: { fromStatus, toStatus: result.status }
    });
  }

  return result;
}

export async function listAdminReservations(
  pool: Pool,
  query: z.infer<typeof adminReservationsListQuerySchema>
) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.status) {
    conditions.push(`r.status = $${i++}::reservation_status`);
    params.push(query.status);
  }
  if (query.organizerId) {
    conditions.push(`r.organizer_id = $${i++}`);
    params.push(query.organizerId);
  }
  if (query.type) {
    conditions.push(`r.type = $${i++}::reservation_type`);
    params.push(query.type);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `SELECT COUNT(*)::text AS count FROM reservations r ${where}`,
    `
      SELECT r.id, r.slot_id, r.organizer_id, r.type::text, r.status::text, r.created_at
      FROM reservations r
      ${where}
      ORDER BY r.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: {
      id: string;
      slot_id: string;
      organizer_id: string;
      type: string;
      status: string;
      created_at: string;
    }) => ({
      id: r.id,
      slotId: r.slot_id,
      organizerId: r.organizer_id,
      type: r.type,
      status: r.status,
      createdAt: r.created_at
    })
  );
}

export async function listAdminBookings(pool: Pool, query: z.infer<typeof adminBookingsListQuerySchema>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.status) {
    conditions.push(`b.status = $${i++}::booking_status`);
    params.push(query.status);
  }
  if (query.userId) {
    conditions.push(`b.user_id = $${i++}`);
    params.push(query.userId);
  }
  if (query.eventId) {
    conditions.push(`b.event_id = $${i++}`);
    params.push(query.eventId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `SELECT COUNT(*)::text AS count FROM bookings b ${where}`,
    `
      SELECT b.id, b.event_id, b.user_id, b.status::text, b.expires_at, b.created_at
      FROM bookings b
      ${where}
      ORDER BY b.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: {
      id: string;
      event_id: string;
      user_id: string;
      status: string;
      expires_at: string | null;
      created_at: string;
    }) => ({
      id: r.id,
      eventId: r.event_id,
      userId: r.user_id,
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at
    })
  );
}

export async function listAdminPayments(pool: Pool, query: z.infer<typeof adminPaymentsListQuerySchema>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.status) {
    conditions.push(`p.status = $${i++}::payment_status`);
    params.push(query.status);
  }
  if (query.userId) {
    conditions.push(`p.user_id = $${i++}`);
    params.push(query.userId);
  }
  if (query.bookingId) {
    conditions.push(`p.booking_id = $${i++}`);
    params.push(query.bookingId);
  }
  if (query.reservationId) {
    conditions.push(`p.reservation_id = $${i++}`);
    params.push(query.reservationId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `SELECT COUNT(*)::text AS count FROM payments p ${where}`,
    `
      SELECT
        p.id, p.user_id, p.booking_id, p.reservation_id, p.reservation_occurrence_id,
        p.status::text, p.gross_amount::text, p.paid_at, p.created_at
      FROM payments p
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: {
      id: string;
      user_id: string;
      booking_id: string | null;
      reservation_id: string | null;
      reservation_occurrence_id: string | null;
      status: string;
      gross_amount: string;
      paid_at: string | null;
      created_at: string;
    }) => ({
      id: r.id,
      userId: r.user_id,
      bookingId: r.booking_id,
      reservationId: r.reservation_id,
      reservationOccurrenceId: r.reservation_occurrence_id,
      status: r.status,
      grossAmount: Number(r.gross_amount),
      paidAt: r.paid_at,
      createdAt: r.created_at
    })
  );
}

export async function listAdminAuditLogs(pool: Pool, query: z.infer<typeof adminAuditLogsListQuerySchema>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (query.actorUserId) {
    conditions.push(`al.actor_user_id = $${i++}`);
    params.push(query.actorUserId);
  }
  if (query.resourceType) {
    conditions.push(`al.resource_type = $${i++}`);
    params.push(query.resourceType);
  }
  if (query.action) {
    conditions.push(`al.action = $${i++}`);
    params.push(query.action);
  }
  if (query.dateFrom) {
    conditions.push(`al.created_at >= $${i++}::timestamptz`);
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    conditions.push(`al.created_at <= $${i++}::timestamptz`);
    params.push(query.dateTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return paginatedQuery(
    pool,
    `SELECT COUNT(*)::text AS count FROM audit_logs al ${where}`,
    `
      SELECT al.id, al.actor_user_id, al.action, al.resource_type, al.resource_id,
        al.reason, al.metadata, al.created_at
      FROM audit_logs al
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `,
    params,
    query,
    (r: {
      id: string;
      actor_user_id: string;
      action: string;
      resource_type: string;
      resource_id: string;
      reason: string | null;
      metadata: unknown;
      created_at: string;
    }) => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      reason: r.reason,
      metadata: r.metadata,
      createdAt: r.created_at
    })
  );
}
