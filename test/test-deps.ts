import type { Pool } from "pg";
import type { RedisAppClient } from "../src/shared/cache/redis/redis";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/shared/env/env";

function defaultTestEnv(overrides?: Partial<Env>): Env {
  return {
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
    reservationTtlSeconds: 1800,
    jwt: {
      secret: "test-secret",
      issuer: "spole-api",
      audience: "spole-clients",
      expiresIn: "7d"
    },
    paymentsWebhookSecret: "test-webhook-secret",
    publicReadCacheTtlSeconds: 60,
    rateLimitAuth: { windowSeconds: 60, maxRequests: 20 },
    rateLimitPublicRead: { windowSeconds: 60, maxRequests: 120 },
    rateLimitAuthenticated: { windowSeconds: 60, maxRequests: 60 },
    rateLimitWebhook: { windowSeconds: 60, maxRequests: 1000 },
    idempotencyTtlSeconds: 86400,
    ...overrides
  };
}

export function createCountingRedisClient(): RedisAppClient {
  const counters = new Map<string, number>();
  return {
    connect: async () => undefined,
    quit: async () => undefined,
    on: () => undefined,
    get: async () => null,
    setEx: async () => undefined,
    del: async () => 1,
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    expire: async () => true
  } as unknown as RedisAppClient;
}

export function createFailingRedisClient(): RedisAppClient {
  return {
    connect: async () => undefined,
    quit: async () => undefined,
    on: () => undefined,
    get: async () => null,
    setEx: async () => undefined,
    del: async () => 1,
    incr: async () => {
      throw new Error("redis unavailable");
    },
    expire: async () => {
      throw new Error("redis unavailable");
    }
  } as unknown as RedisAppClient;
}

export function createStubRedisClient(): RedisAppClient {
  return createCountingRedisClient();
}

export function createTestDeps(params?: {
  pool?: Pool;
  env?: Partial<Env>;
  redis?: RedisAppClient;
}): AppDeps {
  const env = defaultTestEnv(params?.env);

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
