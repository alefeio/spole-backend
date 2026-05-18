import type { Pool, PoolClient } from "pg";

type PgConn = Pool | PoolClient;

export async function expireStaleReservations(conn: PgConn): Promise<number> {
  const res = await conn.query<{ id: string; slot_id: string }>(
    `
      UPDATE reservations
      SET status = 'CANCELLED', updated_at = now()
      WHERE status = 'PENDING'
        AND expires_at IS NOT NULL
        AND expires_at <= now()
      RETURNING id, slot_id
    `
  );
  for (const row of res.rows) {
    await conn.query(
      `
        UPDATE arena_slots
        SET status = 'AVAILABLE', updated_at = now()
        WHERE id = $1 AND status = 'HOLD'
      `,
      [row.slot_id]
    );
  }
  return res.rowCount ?? 0;
}
