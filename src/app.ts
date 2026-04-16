import express from "express";
import { sendFailure } from "./http/api-response";
import { errorMiddleware } from "./http/errors/error-middleware";
import { healthRoutes } from "./http/routes/health";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.use(healthRoutes());

  app.use((_req, res) => {
    return sendFailure(res, 404, "RESOURCE_NOT_FOUND", "Resource not found");
  });

  app.use(errorMiddleware);

  return app;
}
