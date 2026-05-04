import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { AuthUser } from "../../types/auth";
import type { CreateReservationInput } from "./schemas";

type DbReservationRow = {
  id: string;
  slot_id: string;
  organizer_id: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  start_at?: string;
  end_at?: string;
  arena_id?: string;
};

function mapReservation(row: DbReservationRow) {
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

export async function createReservation(pool: Pool, organizerId: string, input: CreateReservationInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const slotRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status::text FROM arena_slots WHERE id = $1 FOR UPDATE`,
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

    const ins = await client.query<{
      id: string;
      slot_id: string;
      organizer_id: string;
      type: string;
      status: string;
    }>(
      `
        INSERT INTO reservations (slot_id, organizer_id, type, status)
        VALUES ($1, $2, 'SINGLE', 'CONFIRMED')
        RETURNING id, slot_id, organizer_id, type::text, status::text
      `,
      [input.slotId, organizerId]
    );
    const row = ins.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "RESERVATION_CREATE_FAILED", message: "Reservation create failed" });
    }

    await client.query(
      `UPDATE arena_slots SET status = 'RESERVED', updated_at = now() WHERE id = $1`,
      [input.slotId]
    );

    await client.query("COMMIT");
    return {
      id: row.id,
      slotId: row.slot_id,
      organizerId: row.organizer_id,
      type: row.type,
      status: row.status
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
  return res.rows.map((row) => mapReservation(row));
}

export async function listArenaReservations(pool: Pool, arenaId: string) {
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
  return res.rows.map((row) => mapReservation(row));
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

export async function getReservationById(pool: Pool, id: string, auth: AuthUser) {
  const row = await loadReservationForAccess(pool, id);
  if (!row) {
    throw new AppError({ status: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
  }

  const isAdmin = auth.role === "admin";
  const isOrganizer = auth.id === row.organizer_id;
  let isArenaOwner = false;
  if (!isAdmin && !isOrganizer && row.arena_id) {
    const o = await pool.query<{ owner_id: string }>(
      `SELECT owner_id FROM arenas WHERE id = $1 LIMIT 1`,
      [row.arena_id]
    );
    const arena = o.rows[0];
    isArenaOwner = Boolean(arena && arena.owner_id === auth.id);
  }

  if (!isAdmin && !isOrganizer && !isArenaOwner) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  return mapReservation(row);
}

export async function cancelReservation(pool: Pool, id: string, auth: AuthUser) {
  const isAdmin = auth.role === "admin";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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
        WHERE id = $1 AND status = 'RESERVED'
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
