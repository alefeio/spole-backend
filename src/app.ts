import type { Pool } from "pg";
import express from "express";
import { arenasRoutes } from "./modules/arenas/routes";
import { authRoutes } from "./modules/auth/routes";
import { categoriesRoutes } from "./modules/categories/routes";
import { eventsRoutes } from "./modules/events/routes";
import { reservationsRoutes } from "./modules/reservations/routes";
import { slotsRoutes } from "./modules/slots/routes";
import { spacesRoutes } from "./modules/spaces/routes";
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
  app.use(categoriesRoutes(deps));
  app.use(eventsRoutes(deps));
  app.use(reservationsRoutes(deps));
  app.use(spacesRoutes(deps));
  app.use(slotsRoutes(deps));
  app.use(arenasRoutes(deps));

  app.use((_req, res) => {
    return sendFailure(res, 404, "RESOURCE_NOT_FOUND", "Resource not found");
  });

  app.use(errorMiddleware);

  return app;
}
