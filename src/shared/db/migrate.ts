import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { Logger } from "../logger/logger";

async function ensureMigrationsTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function runMigrations(pool: Pool, logger: Logger) {
  await ensureMigrationsTable(pool);

  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const id = file;
    const already = await pool.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [id]);
    if (already.rowCount) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    logger.info("applying migration", { file: id });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
