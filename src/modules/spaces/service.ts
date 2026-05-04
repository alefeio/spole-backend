import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { CreateSpaceInput } from "./schemas";

export async function assertArenaExists(pool: Pool, arenaId: string) {
  const r = await pool.query(`SELECT 1 FROM arenas WHERE id = $1 LIMIT 1`, [arenaId]);
  if (!r.rowCount) {
    throw new AppError({ status: 404, code: "ARENA_NOT_FOUND", message: "Arena not found" });
  }
}

export async function createSpace(pool: Pool, arenaId: string, input: CreateSpaceInput) {
  await assertArenaExists(pool, arenaId);

  const status = input.status ?? "ACTIVE";

  const res = await pool.query<{
    id: string;
    arena_id: string;
    name: string;
    type: string;
    description: string | null;
    capacity_suggestion: number | null;
    status: string;
  }>(
    `
      INSERT INTO arena_spaces (arena_id, name, type, description, capacity_suggestion, status)
      VALUES ($1, $2, $3, $4, $5, $6::arena_space_status)
      RETURNING id, arena_id, name, type, description, capacity_suggestion, status::text
    `,
    [
      arenaId,
      input.name,
      input.type,
      input.description ?? null,
      input.capacitySuggestion ?? null,
      status
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppError({ status: 500, code: "SPACE_CREATE_FAILED", message: "Space create failed" });
  }

  return {
    id: row.id,
    arenaId: row.arena_id,
    name: row.name,
    type: row.type,
    description: row.description,
    capacitySuggestion: row.capacity_suggestion,
    status: row.status
  };
}

export async function listSpacesByArena(pool: Pool, arenaId: string) {
  await assertArenaExists(pool, arenaId);

  const res = await pool.query<{
    id: string;
    arena_id: string;
    name: string;
    type: string;
    description: string | null;
    capacity_suggestion: number | null;
    status: string;
  }>(
    `
      SELECT id, arena_id, name, type, description, capacity_suggestion, status::text
      FROM arena_spaces
      WHERE arena_id = $1
      ORDER BY name ASC
    `,
    [arenaId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    arenaId: row.arena_id,
    name: row.name,
    type: row.type,
    description: row.description,
    capacitySuggestion: row.capacity_suggestion,
    status: row.status
  }));
}
