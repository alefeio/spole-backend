import type { Pool } from "pg";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/shared/env/env";

export function createTestDeps(params?: { pool?: Pool; env?: Partial<Env> }): AppDeps {
  const env: Env = {
    port: 3000,
    nodeEnv: "test",
    postgres: {
      host: "localhost",
      port: 5432,
      user: "spole",
      password: "spole",
      db: "spole"
    },
    redis: {
      host: "localhost",
      port: 6379
    },
    jwt: {
      secret: "test-secret",
      issuer: "spole-api",
      audience: "spole-clients",
      expiresIn: "7d"
    },
    ...(params?.env ?? {})
  };

  const pool =
    params?.pool ??
    ({
      query: async () => {
        throw new Error("test pool not configured");
      }
    } as unknown as Pool);

  return { pool, env };
}

export function createTestApp(params?: { pool?: Pool; env?: Partial<Env> }) {
  return createApp(createTestDeps(params));
}
