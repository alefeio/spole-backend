import { createClient } from "redis";
import type { Logger } from "../../logger/logger";

export type RedisConfig = {
  host: string;
  port: number;
  password?: string;
};

export function createRedisClient(config: RedisConfig) {
  const auth = config.password ? `:${encodeURIComponent(config.password)}@` : "";
  const url = `redis://${auth}${config.host}:${config.port}`;
  return createClient({ url });
}

export async function checkRedis(client: ReturnType<typeof createClient>) {
  await client.ping();
}

export function registerRedisHealth(
  client: ReturnType<typeof createClient>,
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
