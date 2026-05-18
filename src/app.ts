import type { Pool } from "pg";
import express from "express";
import { adminRoutes } from "./modules/admin/routes";
import { arenasRoutes } from "./modules/arenas/routes";
import { authRoutes } from "./modules/auth/routes";
import { categoriesRoutes } from "./modules/categories/routes";
import { bookingsRoutes } from "./modules/bookings/routes";
import { notificationsRoutes } from "./modules/notifications/routes";
import { paymentsRoutes } from "./modules/payments/routes";
import { eventParticipantsRoutes } from "./modules/event-participants/routes";
import { eventsRoutes } from "./modules/events/routes";
import { reservationsRoutes } from "./modules/reservations/routes";
import { slotsRoutes } from "./modules/slots/routes";
import { spacesRoutes } from "./modules/spaces/routes";
import { usersRoutes } from "./modules/users/routes";
import { sendFailure } from "./http/api-response";
import { errorMiddleware } from "./http/errors/error-middleware";
import { healthRoutes } from "./http/routes/health";
import type { RedisAppClient } from "./shared/cache/redis/redis";
import type { Env } from "./shared/env/env";

export type AppDeps = {
  pool: Pool;
  env: Env;
  redis: RedisAppClient;
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
  app.use(eventParticipantsRoutes(deps));
  app.use(bookingsRoutes(deps));
  app.use(notificationsRoutes(deps));
  app.use(paymentsRoutes(deps));
  app.use(reservationsRoutes(deps));
  app.use(spacesRoutes(deps));
  app.use(slotsRoutes(deps));
  app.use(arenasRoutes(deps));
  app.use(adminRoutes(deps));

  app.use((_req, res) => {
    return sendFailure(res, 404, "RESOURCE_NOT_FOUND", "Resource not found");
  });

  app.use(errorMiddleware);

  return app;
}
