import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/shared/env/env";
import { checkRedis, createRedisClient } from "../src/shared/cache/redis/redis";

describe("infra: redis", () => {
  it("deve conectar e responder ao ping", async () => {
    const env = loadEnv();
    const client = createRedisClient(env.redis);

    try {
      await client.connect();
      await checkRedis(client);
      expect(true).toBe(true);
    } finally {
      await client.quit().catch(() => undefined);
    }
  });
});
