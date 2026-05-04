import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/shared/env/env";

describe("env", () => {
  it("deve falhar quando faltar variável obrigatória", () => {
    const prev = { ...process.env };
    try {
      delete process.env.POSTGRES_HOST;
      delete process.env.POSTGRES_USER;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.POSTGRES_DB;
      delete process.env.REDIS_HOST;
      delete process.env.JWT_SECRET;
      delete process.env.PAYMENTS_WEBHOOK_SECRET;

      expect(() => loadEnv()).toThrow(/Missing required env var/);
    } finally {
      process.env = prev;
    }
  });

  it("deve carregar env quando completo", () => {
    const prev = { ...process.env };
    try {
      process.env.PORT = "3001";
      process.env.POSTGRES_HOST = "localhost";
      process.env.POSTGRES_PORT = "5432";
      process.env.POSTGRES_USER = "spole";
      process.env.POSTGRES_PASSWORD = "spole";
      process.env.POSTGRES_DB = "spole";
      process.env.REDIS_HOST = "localhost";
      process.env.REDIS_PORT = "6379";
      process.env.JWT_SECRET = "test-secret";
      process.env.PAYMENTS_WEBHOOK_SECRET = "test-webhook-secret";

      const env = loadEnv();
      expect(env.port).toBe(3001);
      expect(env.postgres.host).toBe("localhost");
      expect(env.redis.host).toBe("localhost");
      expect(env.bookingTtlSeconds).toBe(1800);
      expect(env.jwt.secret).toBe("test-secret");
      expect(env.paymentsWebhookSecret).toBe("test-webhook-secret");
      expect(env.publicReadCacheTtlSeconds).toBe(60);
    } finally {
      process.env = prev;
    }
  });
});
