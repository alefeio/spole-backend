import type { PoolClient } from "pg";
import { createLogger } from "../../shared/logger/logger";
import { ensureRecurrenceRow, generateNextWeeklyOccurrence } from "./recurrence";

const log = createLogger("reservations");

export async function confirmReservationInTransaction(
  client: PoolClient,
  reservationId: string,
  paidAmount: number
): Promise<void> {
  const res = await client.query<{
    id: string;
    slot_id: string;
    status: string;
    type: string;
  }>(
    `
      SELECT id, slot_id, status::text, type::text
      FROM reservations
      WHERE id = $1
      FOR UPDATE
    `,
    [reservationId]
  );
  const row = res.rows[0];
  if (!row) {
    return;
  }
  if (row.status === "CONFIRMED") {
    return;
  }
  if (row.status !== "PENDING") {
    return;
  }

  const upd = await client.query(
    `
      UPDATE reservations
      SET
        status = 'CONFIRMED',
        paid_amount = $2,
        confirmed_at = now(),
        updated_at = now()
      WHERE id = $1 AND status = 'PENDING'
    `,
    [reservationId, paidAmount]
  );
  if (upd.rowCount !== 1) {
    return;
  }

  await client.query(
    `
      UPDATE arena_slots
      SET status = 'RESERVED', updated_at = now()
      WHERE id = $1
    `,
    [row.slot_id]
  );

  if (row.type === "RECURRING") {
    const slotTime = await client.query<{ start_at: string }>(
      `SELECT start_at FROM arena_slots WHERE id = $1`,
      [row.slot_id]
    );
    const startAt = slotTime.rows[0]?.start_at;
    if (startAt) {
      const recurrenceId = await ensureRecurrenceRow(client, reservationId, startAt);
      await generateNextWeeklyOccurrence(client, recurrenceId);
    }
  }
}

export async function confirmOccurrenceInTransaction(
  client: PoolClient,
  occurrenceId: string
): Promise<void> {
  const occ = await client.query<{
    id: string;
    recurrence_id: string;
    slot_id: string;
    status: string;
  }>(
    `
      SELECT id, recurrence_id, slot_id, status::text
      FROM reservation_occurrences
      WHERE id = $1
      FOR UPDATE
    `,
    [occurrenceId]
  );
  const row = occ.rows[0];
  if (!row || row.status === "CONFIRMED") {
    return;
  }
  if (row.status !== "PENDING_PAYMENT") {
    return;
  }

  const upd = await client.query(
    `
      UPDATE reservation_occurrences
      SET status = 'CONFIRMED', paid_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'PENDING_PAYMENT'
    `,
    [occurrenceId]
  );
  if (upd.rowCount !== 1) {
    return;
  }

  await client.query(
    `
      UPDATE arena_slots
      SET status = 'RESERVED', updated_at = now()
      WHERE id = $1
    `,
    [row.slot_id]
  );

  await generateNextWeeklyOccurrence(client, row.recurrence_id);
}

export function logAutoConfirmReservation(reservationId: string, reason: string) {
  log.info("reservation auto-confirmed", { reservationId, reason });
}
