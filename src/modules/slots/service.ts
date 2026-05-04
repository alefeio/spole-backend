import type { Pool, PoolClient } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { CreateSlotInput, ListSlotsQuery } from "./schemas";

async function assertSpaceExists(pool: Pool, spaceId: string) {
  const r = await pool.query(`SELECT 1 FROM arena_spaces WHERE id = $1 LIMIT 1`, [spaceId]);
  if (!r.rowCount) {
    throw new AppError({ status: 404, code: "SPACE_NOT_FOUND", message: "Space not found" });
  }
}

async function hasSlotOverlap(
  conn: Pool | PoolClient,
  spaceId: string,
  startAt: string,
  endAt: string
): Promise<boolean> {
  const r = await conn.query(
    `
      SELECT 1
      FROM arena_slots
      WHERE space_id = $1
        AND status = 'AVAILABLE'
        AND start_at < $3::timestamptz
        AND end_at > $2::timestamptz
      LIMIT 1
    `,
    [spaceId, startAt, endAt]
  );
  return Boolean(r.rowCount);
}

export async function createSlot(pool: Pool, spaceId: string, input: CreateSlotInput) {
  await assertSpaceExists(pool, spaceId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (await hasSlotOverlap(client, spaceId, input.startAt, input.endAt)) {
      throw new AppError({
        status: 409,
        code: "SLOT_OVERLAP",
        message: "Slot overlaps an existing available slot in this space"
      });
    }

    const res = await client.query<{ id: string; status: string }>(
      `
        INSERT INTO arena_slots (space_id, start_at, end_at, price, status, allows_recurring, notes)
        VALUES ($1, $2, $3, $4, 'AVAILABLE', $5, $6)
        RETURNING id, status::text
      `,
      [
        spaceId,
        input.startAt,
        input.endAt,
        input.price,
        input.allowsRecurring,
        input.notes ?? null
      ]
    );

    const row = res.rows[0];
    if (!row) {
      throw new AppError({ status: 500, code: "SLOT_CREATE_FAILED", message: "Slot create failed" });
    }

    await client.query("COMMIT");
    return { id: row.id, status: row.status };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

function mapSlotRow(row: {
  id: string;
  space_id: string;
  start_at: string;
  end_at: string;
  price: string;
  status: string;
  allows_recurring: boolean;
  notes: string | null;
}) {
  return {
    id: row.id,
    spaceId: row.space_id,
    startAt: row.start_at,
    endAt: row.end_at,
    price: Number(row.price),
    status: row.status,
    allowsRecurring: row.allows_recurring,
    notes: row.notes
  };
}

export async function listSlotsBySpace(pool: Pool, spaceId: string, query: ListSlotsQuery) {
  await assertSpaceExists(pool, spaceId);

  const conditions = [`s.space_id = $1`, `s.status = 'AVAILABLE'`];
  const params: unknown[] = [spaceId];
  let i = 2;

  if (query.dateFrom) {
    conditions.push(`s.end_at > $${i++}`);
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    conditions.push(`s.start_at < $${i++}`);
    params.push(query.dateTo);
  }

  const whereSql = conditions.join(" AND ");
  const offset = (query.page - 1) * query.limit;

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM arena_slots s WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  params.push(query.limit, offset);
  const limitIdx = i++;
  const offsetIdx = i++;

  const listRes = await pool.query(
    `
      SELECT s.id, s.space_id, s.start_at, s.end_at, s.price::text, s.status::text, s.allows_recurring, s.notes
      FROM arena_slots s
      WHERE ${whereSql}
      ORDER BY s.start_at ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  const data = listRes.rows.map((row) => mapSlotRow(row as Parameters<typeof mapSlotRow>[0]));

  return {
    data,
    meta: { page: query.page, limit: query.limit, total }
  };
}

export async function listSlotsByArena(pool: Pool, arenaId: string, query: ListSlotsQuery) {
  const arenaOk = await pool.query(`SELECT 1 FROM arenas WHERE id = $1 LIMIT 1`, [arenaId]);
  if (!arenaOk.rowCount) {
    throw new AppError({ status: 404, code: "ARENA_NOT_FOUND", message: "Arena not found" });
  }

  const conditions = [`a.id = $1`, `s.status = 'AVAILABLE'`];
  const params: unknown[] = [arenaId];
  let i = 2;

  if (query.dateFrom) {
    conditions.push(`s.end_at > $${i++}`);
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    conditions.push(`s.start_at < $${i++}`);
    params.push(query.dateTo);
  }

  const whereSql = conditions.join(" AND ");
  const offset = (query.page - 1) * query.limit;

  const countRes = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM arena_slots s
      INNER JOIN arena_spaces sp ON sp.id = s.space_id
      INNER JOIN arenas a ON a.id = sp.arena_id
      WHERE ${whereSql}
    `,
    params
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  params.push(query.limit, offset);
  const limitIdx = i++;
  const offsetIdx = i++;

  const listRes = await pool.query(
    `
      SELECT s.id, s.space_id, s.start_at, s.end_at, s.price::text, s.status::text, s.allows_recurring, s.notes
      FROM arena_slots s
      INNER JOIN arena_spaces sp ON sp.id = s.space_id
      INNER JOIN arenas a ON a.id = sp.arena_id
      WHERE ${whereSql}
      ORDER BY s.start_at ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  const data = listRes.rows.map((row) => mapSlotRow(row as Parameters<typeof mapSlotRow>[0]));

  return {
    data,
    meta: { page: query.page, limit: query.limit, total }
  };
}
