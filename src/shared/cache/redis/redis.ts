import { createClient } from "redis";
import type { Logger } from "../../logger/logger";

export type RedisConfig = {
  host: string;
  port: number;
  password?: string;
};

export type RedisAppClient = ReturnType<typeof createClient>;

export function createRedisClient(config: RedisConfig): RedisAppClient {
  const auth = config.password ? `:${encodeURIComponent(config.password)}@` : "";
  const url = `redis://${auth}${config.host}:${config.port}`;
  return createClient({ url });
}

export async function checkRedis(client: RedisAppClient) {
  await client.ping();
}

export function registerRedisHealth(
  client: RedisAppClient,
  logger: Logger,
  setHealthy: (ok: boolean) => void
) {
  client.on("error", (err) => {
    logger.error("redis client error", { message: err?.message ?? String(err) });
    setHealthy(false);
  });
  client.on("end", () => {
    logger.warn("redis client ended");
    setHealthy(false);
  });
}
