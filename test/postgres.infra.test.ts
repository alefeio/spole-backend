import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/shared/env/env";
import { checkPostgres, createPostgresPool } from "../src/shared/db/postgres/postgres";

describe("infra: postgres", () => {
  it("deve conectar e responder a um ping simples", async () => {
    const env = loadEnv();
    const pool = createPostgresPool(env.postgres);

    try {
      await checkPostgres(pool);
      expect(true).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
