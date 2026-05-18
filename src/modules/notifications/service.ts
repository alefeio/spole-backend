import type { Pool, PoolClient } from "pg";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import type { PaginationMeta, PaginationQuery } from "../../shared/http/pagination";
import type { AuthUser } from "../../types/auth";

export type NotificationType = "PAYMENT_CONFIRMED" | "BOOKING_CANCELLED";

type PgConn = Pool | PoolClient;

export async function insertNotification(
  conn: PgConn,
  input: {
    userId: string;
    title: string;
    message: string;
    type: NotificationType;
  }
): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `
      INSERT INTO notifications (user_id, title, message, type)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [input.userId, input.title, input.message, input.type]
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new AppError({ status: 500, code: "NOTIFICATION_CREATE_FAILED", message: "Notification create failed" });
  }
  return id;
}

export async function listMyNotifications(
  deps: AppDeps,
  auth: AuthUser,
  query: PaginationQuery
): Promise<{ data: NotificationRow[]; meta: PaginationMeta }> {
  const countRes = await deps.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1`,
    [auth.id]
  );
  const total = Number(countRes.rows[0]?.count ?? 0);
  const offset = (query.page - 1) * query.limit;

  const res = await deps.pool.query<{
    id: string;
    title: string;
    message: string;
    type: string;
    read_at: string | null;
    created_at: string;
  }>(
    `
      SELECT id, title, message, type::text, read_at, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [auth.id, query.limit, offset]
  );

  return {
    data: res.rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      type: r.type as NotificationType,
      readAt: r.read_at,
      createdAt: r.created_at
    })),
    meta: { page: query.page, limit: query.limit, total }
  };
}

export type NotificationRow = {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  readAt: string | null;
  createdAt: string;
};

export async function markNotificationRead(deps: AppDeps, auth: AuthUser, notificationId: string) {
  const snap = await deps.pool.query<{ id: string; user_id: string; read_at: string | null }>(
    `SELECT id, user_id, read_at FROM notifications WHERE id = $1`,
    [notificationId]
  );
  const row = snap.rows[0];
  if (!row) {
    throw new AppError({ status: 404, code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" });
  }
  if (auth.role !== "admin" && row.user_id !== auth.id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  if (row.read_at) {
    return { id: row.id, readAt: row.read_at };
  }

  const upd = await deps.pool.query<{ id: string; read_at: string }>(
    `
      UPDATE notifications
      SET read_at = now()
      WHERE id = $1 AND read_at IS NULL
      RETURNING id, read_at
    `,
    [notificationId]
  );
  const updated = upd.rows[0];
  if (!updated) {
    const again = await deps.pool.query<{ read_at: string }>(
      `SELECT read_at FROM notifications WHERE id = $1`,
      [notificationId]
    );
    const readAt = again.rows[0]?.read_at;
    if (readAt) {
      return { id: notificationId, readAt };
    }
    throw new AppError({ status: 404, code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" });
  }

  return { id: updated.id, readAt: updated.read_at };
}
