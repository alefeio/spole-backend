import { Pool } from "pg";
import type { Logger } from "../../logger/logger";

export type PostgresConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
};

export function createPostgresPool(config: PostgresConfig) {
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.db,
    max: 10
  });
}

export async function checkPostgres(pool: Pool) {
  await pool.query("SELECT 1");
}

export function registerPostgresHealth(
  pool: Pool,
  logger: Logger,
  setHealthy: (ok: boolean) => void
) {
  pool.on("error", (err) => {
    logger.error("postgres pool error", { message: err.message });
    setHealthy(false);
  });
}
