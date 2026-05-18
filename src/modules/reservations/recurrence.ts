import type { PoolClient } from "pg";
import { AppError } from "../../shared/errors/app-error";

const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

export function computeOccurrenceDueAt(slotStartAt: Date): Date {
  return new Date(slotStartAt.getTime() - 24 * 60 * 60 * 1000);
}

export function dayOfWeekFromDate(d: Date): number {
  return d.getUTCDay();
}

async function hasBlockingSlotOverlap(
  client: PoolClient,
  spaceId: string,
  startAt: string,
  endAt: string,
  excludeSlotId?: string
): Promise<boolean> {
  const r = await client.query(
    `
      SELECT 1
      FROM arena_slots
      WHERE space_id = $1
        AND id <> COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND status NOT IN ('CANCELLED', 'EXPIRED')
        AND start_at < $3::timestamptz
        AND end_at > $2::timestamptz
      LIMIT 1
    `,
    [spaceId, startAt, endAt, excludeSlotId ?? null]
  );
  return Boolean(r.rowCount);
}

export async function releaseStaleReservationOccurrences(client: PoolClient): Promise<number> {
  const res = await client.query<{ id: string; slot_id: string }>(
    `
      UPDATE reservation_occurrences
      SET status = 'RELEASED', released_at = now(), updated_at = now()
      WHERE status = 'PENDING_PAYMENT'
        AND due_at <= now()
      RETURNING id, slot_id
    `
  );
  for (const row of res.rows) {
    await client.query(
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

export async function generateNextWeeklyOccurrence(
  client: PoolClient,
  recurrenceId: string
): Promise<string | null> {
  const rec = await client.query<{
    reservation_id: string;
    active: boolean;
    organizer_id: string;
  }>(
    `
      SELECT rr.reservation_id, rr.active, r.organizer_id
      FROM reservation_recurrences rr
      INNER JOIN reservations r ON r.id = rr.reservation_id
      WHERE rr.id = $1
      FOR UPDATE
    `,
    [recurrenceId]
  );
  const row = rec.rows[0];
  if (!row?.active) {
    return null;
  }

  const pending = await client.query(
    `
      SELECT 1 FROM reservation_occurrences
      WHERE recurrence_id = $1 AND status = 'PENDING_PAYMENT'
      LIMIT 1
    `,
    [recurrenceId]
  );
  if (pending.rowCount) {
    return null;
  }

  const last = await client.query<{
    slot_id: string;
    space_id: string;
    start_at: string;
    end_at: string;
    price: string;
    allows_recurring: boolean;
  }>(
    `
      SELECT
        s.id AS slot_id,
        s.space_id,
        s.start_at,
        s.end_at,
        s.price::text,
        s.allows_recurring
      FROM reservation_occurrences o
      INNER JOIN arena_slots s ON s.id = o.slot_id
      WHERE o.recurrence_id = $1
      ORDER BY s.start_at DESC
      LIMIT 1
    `,
    [recurrenceId]
  );

  let baseStart: Date;
  let baseEnd: Date;
  let spaceId: string;
  let price: number;
  let allowsRecurring: boolean;

  if (last.rows[0]) {
    const s = last.rows[0];
    baseStart = new Date(s.start_at);
    baseEnd = new Date(s.end_at);
    spaceId = s.space_id;
    price = Number(s.price);
    allowsRecurring = s.allows_recurring;
  } else {
    const parent = await client.query<{
      slot_id: string;
      space_id: string;
      start_at: string;
      end_at: string;
      price: string;
      allows_recurring: boolean;
    }>(
      `
        SELECT
          s.id AS slot_id,
          s.space_id,
          s.start_at,
          s.end_at,
          s.price::text,
          s.allows_recurring
        FROM reservations r
        INNER JOIN arena_slots s ON s.id = r.slot_id
        WHERE r.id = $1
      `,
      [row.reservation_id]
    );
    const p = parent.rows[0];
    if (!p) {
      return null;
    }
    baseStart = new Date(p.start_at);
    baseEnd = new Date(p.end_at);
    spaceId = p.space_id;
    price = Number(p.price);
    allowsRecurring = p.allows_recurring;
  }

  const nextStart = new Date(baseStart.getTime() + MS_WEEK);
  const nextEnd = new Date(baseEnd.getTime() + MS_WEEK);
  const nextStartIso = nextStart.toISOString();
  const nextEndIso = nextEnd.toISOString();

  if (await hasBlockingSlotOverlap(client, spaceId, nextStartIso, nextEndIso)) {
    return null;
  }

  const slotIns = await client.query<{ id: string }>(
    `
      INSERT INTO arena_slots (space_id, start_at, end_at, price, status, allows_recurring)
      VALUES ($1, $2, $3, $4, 'HOLD', $5)
      RETURNING id
    `,
    [spaceId, nextStartIso, nextEndIso, price, allowsRecurring]
  );
  const newSlotId = slotIns.rows[0]?.id;
  if (!newSlotId) {
    throw new AppError({
      status: 500,
      code: "OCCURRENCE_SLOT_CREATE_FAILED",
      message: "Failed to create slot for recurrence occurrence"
    });
  }

  const dueAt = computeOccurrenceDueAt(nextStart);
  const occIns = await client.query<{ id: string }>(
    `
      INSERT INTO reservation_occurrences (recurrence_id, slot_id, status, due_at)
      VALUES ($1, $2, 'PENDING_PAYMENT', $3)
      RETURNING id
    `,
    [recurrenceId, newSlotId, dueAt.toISOString()]
  );
  return occIns.rows[0]?.id ?? null;
}

export async function ensureRecurrenceRow(
  client: PoolClient,
  reservationId: string,
  slotStartAt: string
): Promise<string> {
  const start = new Date(slotStartAt);
  const dow = dayOfWeekFromDate(start);
  const ins = await client.query<{ id: string }>(
    `
      INSERT INTO reservation_recurrences (reservation_id, frequency, day_of_week, active)
      VALUES ($1, 'WEEKLY', $2, true)
      ON CONFLICT (reservation_id) DO UPDATE SET updated_at = now()
      RETURNING id
    `,
    [reservationId, dow]
  );
  const id = ins.rows[0]?.id;
  if (!id) {
    throw new AppError({
      status: 500,
      code: "RECURRENCE_CREATE_FAILED",
      message: "Failed to create reservation recurrence"
    });
  }
  return id;
}
