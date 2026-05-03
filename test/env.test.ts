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

      const env = loadEnv();
      expect(env.port).toBe(3001);
      expect(env.postgres.host).toBe("localhost");
      expect(env.redis.host).toBe("localhost");
    } finally {
      process.env = prev;
    }
  });
});
