import type { Pool } from "pg";
import express from "express";
import { authRoutes } from "./modules/auth/routes";
import { usersRoutes } from "./modules/users/routes";
import { sendFailure } from "./http/api-response";
import { errorMiddleware } from "./http/errors/error-middleware";
import { healthRoutes } from "./http/routes/health";
import type { Env } from "./shared/env/env";

export type AppDeps = {
  pool: Pool;
  env: Env;
};

export function createApp(deps: AppDeps) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.use((req, _res, next) => {
    req.pg = deps.pool;
    next();
  });

  app.use(healthRoutes());
  app.use(authRoutes(deps));
  app.use(usersRoutes(deps));

  app.use((_req, res) => {
    return sendFailure(res, 404, "RESOURCE_NOT_FOUND", "Resource not found");
  });

  app.use(errorMiddleware);

  return app;
}
