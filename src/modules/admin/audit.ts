import type { Pool, PoolClient } from "pg";

type PgConn = Pool | PoolClient;

export const AuditAction = {
  USER_STATUS_CHANGED: "USER_STATUS_CHANGED",
  ARENA_STATUS_CHANGED: "ARENA_STATUS_CHANGED",
  EVENT_STATUS_CHANGED: "EVENT_STATUS_CHANGED"
} as const;

export type AuditResourceType = "USER" | "ARENA" | "EVENT";

export async function insertAuditLog(
  conn: PgConn,
  input: {
    actorUserId: string;
    action: string;
    resourceType: AuditResourceType;
    resourceId: string;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `
      INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.reason ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error("Audit log insert failed");
  }
  return id;
}
