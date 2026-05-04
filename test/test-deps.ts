import type { Pool } from "pg";
import type { RedisAppClient } from "../src/shared/cache/redis/redis";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/shared/env/env";

export function createStubRedisClient(): RedisAppClient {
  return {
    connect: async () => undefined,
    quit: async () => undefined,
    on: () => undefined,
    setEx: async () => undefined,
    del: async () => 1
  } as unknown as RedisAppClient;
}

export function createTestDeps(params?: {
  pool?: Pool;
  env?: Partial<Env>;
  redis?: RedisAppClient;
}): AppDeps {
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
    bookingTtlSeconds: 1800,
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

  return { pool, env, redis: params?.redis ?? createStubRedisClient() };
}

export function createTestApp(params?: {
  pool?: Pool;
  env?: Partial<Env>;
  redis?: RedisAppClient;
}) {
  return createApp(createTestDeps(params));
}
