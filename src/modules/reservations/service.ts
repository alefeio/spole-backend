import type { Pool } from "pg";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import type { AuthUser } from "../../types/auth";
import { confirmReservationInTransaction, logAutoConfirmReservation } from "./confirm";
import type { CreateReservationInput } from "./schemas";
import { expireStaleReservations } from "./expire";
import { releaseStaleReservationOccurrences } from "./recurrence";

type DbReservationRow = {
  id: string;
  slot_id: string;
  organizer_id: string;
  type: string;
  status: string;
  total_price?: string;
  required_payment_amount?: string;
  paid_amount?: string;
  expires_at?: string | null;
  confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
  start_at?: string;
  end_at?: string;
  arena_id?: string;
};

function mapReservationListItem(row: DbReservationRow) {
  return {
    id: row.id,
    slotId: row.slot_id,
    organizerId: row.organizer_id,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.start_at != null && row.end_at != null
      ? { slot: { startAt: row.start_at, endAt: row.end_at } }
      : {})
  };
}

async function runMaintenance(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await expireStaleReservations(client);
    await releaseStaleReservationOccurrences(client);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
  }
}

export async function createReservation(deps: AppDeps, organizerId: string, input: CreateReservationInput) {
  const { pool, env } = deps;
  await runMaintenance(pool);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const slotRes = await client.query<{
      id: string;
      status: string;
      price: string;
      start_at: string;
      end_at: string;
      allows_recurring: boolean;
      space_id: string;
      arena_id: string;
      allow_recurring: boolean;
      min_advance_hours: number;
      min_reservation_payment_percent: number;
    }>(
      `
        SELECT
          s.id,
          s.status::text,
          s.price::text,
          s.start_at,
          s.end_at,
          s.allows_recurring,
          s.space_id,
          sp.arena_id,
          p.allow_recurring,
          p.min_advance_hours,
          p.min_reservation_payment_percent
        FROM arena_slots s
        INNER JOIN arena_spaces sp ON sp.id = s.space_id
        INNER JOIN arena_policies p ON p.arena_id = sp.arena_id
        WHERE s.id = $1
        FOR UPDATE
      `,
      [input.slotId]
    );
    const slot = slotRes.rows[0];
    if (!slot) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "SLOT_NOT_FOUND", message: "Slot not found" });
    }
    if (slot.status !== "AVAILABLE") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "SLOT_UNAVAILABLE",
        message: "Slot is not available for reservation"
      });
    }

    if (input.type === "RECURRING") {
      if (!slot.allow_recurring || !slot.allows_recurring) {
        await client.query("ROLLBACK");
        throw new AppError({
          status: 422,
          code: "RECURRENCE_NOT_ALLOWED",
          message: "Recurring reservation is not allowed for this slot or arena"
        });
      }
    }

    const startAt = new Date(slot.start_at);
    const minAdvanceMs = slot.min_advance_hours * 60 * 60 * 1000;
    if (startAt.getTime() - Date.now() < minAdvanceMs) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "MIN_ADVANCE_VIOLATION",
        message: "Reservation does not meet minimum advance hours"
      });
    }

    const totalPrice = Number(slot.price);
    if (!Number.isFinite(totalPrice) || totalPrice < 0) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "INVALID_SLOT_PRICE",
        message: "Slot price is invalid"
      });
    }

    const requiredPayment = (totalPrice * slot.min_reservation_payment_percent) / 100;
    const expiresAt = new Date(Date.now() + env.reservationTtlSeconds * 1000);

    const ins = await client.query<{
      id: string;
      slot_id: string;
      organizer_id: string;
      type: string;
      status: string;
    }>(
      `
        INSERT INTO reservations (
          slot_id, organizer_id, type, status,
          total_price, required_payment_amount, paid_amount, expires_at
        )
        VALUES ($1, $2, $3, 'PENDING', $4, $5, 0, $6)
        RETURNING id, slot_id, organizer_id, type::text, status::text
      `,
      [input.slotId, organizerId, input.type, totalPrice, requiredPayment, expiresAt.toISOString()]
    );
    const row = ins.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "RESERVATION_CREATE_FAILED", message: "Reservation create failed" });
    }

    await client.query(
      `UPDATE arena_slots SET status = 'HOLD', updated_at = now() WHERE id = $1`,
      [input.slotId]
    );

    let status = row.status;
    if (requiredPayment <= 0) {
      logAutoConfirmReservation(row.id, "min_reservation_payment_percent_is_zero");
      await confirmReservationInTransaction(client, row.id, 0);
      status = "CONFIRMED";
    }

    await client.query("COMMIT");
    return {
      id: row.id,
      slotId: row.slot_id,
      organizerId: row.organizer_id,
      type: row.type,
      status
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "RESERVATION_CONFLICT",
        message: "Slot already has an active reservation"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyReservations(pool: Pool, organizerId: string) {
  await runMaintenance(pool);
  const res = await pool.query<DbReservationRow>(
    `
      SELECT
        r.id,
        r.slot_id,
        r.organizer_id,
        r.type::text,
        r.status::text,
        r.created_at,
        r.updated_at,
        s.start_at,
        s.end_at
      FROM reservations r
      INNER JOIN arena_slots s ON s.id = r.slot_id
      WHERE r.organizer_id = $1
      ORDER BY r.created_at DESC
    `,
    [organizerId]
  );
  return res.rows.map((row) => mapReservationListItem(row));
}

export async function listArenaReservations(pool: Pool, arenaId: string) {
  await runMaintenance(pool);
  const res = await pool.query<DbReservationRow>(
    `
      SELECT
        r.id,
        r.slot_id,
        r.organizer_id,
        r.type::text,
        r.status::text,
        r.created_at,
        r.updated_at,
        s.start_at,
        s.end_at,
        sp.arena_id
      FROM reservations r
      INNER JOIN arena_slots s ON s.id = r.slot_id
      INNER JOIN arena_spaces sp ON sp.id = s.space_id
      WHERE sp.arena_id = $1
      ORDER BY s.start_at ASC
    `,
    [arenaId]
  );
  return res.rows.map((row) => mapReservationListItem(row));
}

async function loadReservationForAccess(pool: Pool, id: string): Promise<DbReservationRow | null> {
  const res = await pool.query<DbReservationRow>(
    `
      SELECT
        r.id,
        r.slot_id,
        r.organizer_id,
        r.type::text,
        r.status::text,
        r.total_price::text,
        r.required_payment_amount::text,
        r.paid_amount::text,
        r.expires_at,
        r.confirmed_at,
        r.created_at,
        r.updated_at,
        s.start_at,
        s.end_at,
        sp.arena_id
      FROM reservations r
      INNER JOIN arena_slots s ON s.id = r.slot_id
      INNER JOIN arena_spaces sp ON sp.id = s.space_id
      WHERE r.id = $1
      LIMIT 1
    `,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function getReservationById(deps: AppDeps, id: string, auth: AuthUser) {
  await runMaintenance(deps.pool);
  const row = await loadReservationForAccess(deps.pool, id);
  if (!row) {
    throw new AppError({ status: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
  }

  const isAdmin = auth.role === "admin";
  const isOrganizer = auth.id === row.organizer_id;
  let isArenaOwner = false;
  if (!isAdmin && !isOrganizer && row.arena_id) {
    const o = await deps.pool.query<{ owner_id: string }>(
      `SELECT owner_id FROM arenas WHERE id = $1 LIMIT 1`,
      [row.arena_id]
    );
    const arena = o.rows[0];
    isArenaOwner = Boolean(arena && arena.owner_id === auth.id);
  }

  if (!isAdmin && !isOrganizer && !isArenaOwner) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  const recurrenceRes = await deps.pool.query<{
    id: string;
    frequency: string;
    day_of_week: number;
    active: boolean;
  }>(
    `
      SELECT id, frequency::text, day_of_week, active
      FROM reservation_recurrences
      WHERE reservation_id = $1
      LIMIT 1
    `,
    [id]
  );
  const recurrence = recurrenceRes.rows[0];

  let nextOccurrence: {
    id: string;
    status: string;
    dueAt: string;
    slot: { startAt: string; endAt: string };
  } | null = null;

  if (recurrence) {
    const occRes = await deps.pool.query<{
      id: string;
      status: string;
      due_at: string;
      start_at: string;
      end_at: string;
    }>(
      `
        SELECT o.id, o.status::text, o.due_at, s.start_at, s.end_at
        FROM reservation_occurrences o
        INNER JOIN arena_slots s ON s.id = o.slot_id
        WHERE o.recurrence_id = $1
          AND o.status = 'PENDING_PAYMENT'
        ORDER BY s.start_at ASC
        LIMIT 1
      `,
      [recurrence.id]
    );
    const occ = occRes.rows[0];
    if (occ) {
      nextOccurrence = {
        id: occ.id,
        status: occ.status,
        dueAt: occ.due_at,
        slot: { startAt: occ.start_at, endAt: occ.end_at }
      };
    }
  }

  return {
    ...mapReservationListItem(row),
    financial: {
      totalPrice: Number(row.total_price ?? 0),
      requiredPaymentAmount: Number(row.required_payment_amount ?? 0),
      paidAmount: Number(row.paid_amount ?? 0),
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at
    },
    recurrence: recurrence
      ? {
          id: recurrence.id,
          frequency: recurrence.frequency,
          dayOfWeek: recurrence.day_of_week,
          active: recurrence.active
        }
      : null,
    nextOccurrence
  };
}

export async function cancelReservation(pool: Pool, id: string, auth: AuthUser) {
  const isAdmin = auth.role === "admin";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await expireStaleReservations(client);
    await releaseStaleReservationOccurrences(client);

    const res = await client.query<{ id: string; organizer_id: string; status: string; slot_id: string }>(
      `
        SELECT r.id, r.organizer_id, r.status::text, r.slot_id
        FROM reservations r
        WHERE r.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const row = res.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
    }

    if (!isAdmin && row.organizer_id !== auth.id) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
    }

    if (row.status === "CANCELLED") {
      await client.query("COMMIT");
      return { id: row.id, status: "CANCELLED" as const };
    }

    if (row.status === "CONSUMED") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "RESERVATION_ALREADY_CONSUMED",
        message: "Reservation was already used for an event and cannot be cancelled"
      });
    }

    await client.query(
      `
        UPDATE reservations
        SET status = 'CANCELLED', updated_at = now()
        WHERE id = $1
      `,
      [id]
    );

    await client.query(
      `
        UPDATE arena_slots
        SET status = 'AVAILABLE', updated_at = now()
        WHERE id = $1 AND status IN ('RESERVED', 'HOLD')
      `,
      [row.slot_id]
    );

    await client.query("COMMIT");
    return { id: row.id, status: "CANCELLED" as const };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
