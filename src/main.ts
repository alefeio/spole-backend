import "dotenv/config";

import { createApp } from "./app";
import { createRedisClient, registerRedisHealth } from "./shared/cache/redis/redis";
import { runMigrations } from "./shared/db/migrate";
import { createPostgresPool, registerPostgresHealth } from "./shared/db/postgres/postgres";
import { loadEnv } from "./shared/env/env";
import { setPostgresHealthy, setRedisHealthy } from "./shared/health/health";
import { createLogger } from "./shared/logger/logger";

const logger = createLogger("bootstrap");

async function bootstrap() {
  const env = loadEnv();

  const postgres = createPostgresPool(env.postgres);
  const redis = createRedisClient(env.redis);

  registerPostgresHealth(postgres, logger, setPostgresHealthy);
  registerRedisHealth(redis, logger, setRedisHealthy);

  logger.info("connecting to postgres...");
  try {
    await postgres.query("SELECT 1");
    setPostgresHealthy(true);
  } catch (err) {
    logger.error("failed to connect to postgres", { message: (err as Error).message });
    await postgres.end().catch(() => undefined);
    process.exit(1);
  }

  try {
    await runMigrations(postgres, logger);
  } catch (err) {
    logger.error("failed to run migrations", { message: (err as Error).message });
    await postgres.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(1);
  }

  logger.info("connecting to redis...");
  try {
    await redis.connect();
    await redis.ping();
    setRedisHealthy(true);
  } catch (err) {
    logger.error("failed to connect to redis", { message: (err as Error).message });
    await postgres.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(1);
  }

  const app = createApp({ pool: postgres, env, redis });

  app.listen(env.port, () => {
    logger.info("listening", { port: env.port });
  });
}

bootstrap().catch((err) => {
  logger.error("bootstrap crashed", { message: (err as Error).message });
  process.exit(1);
});
