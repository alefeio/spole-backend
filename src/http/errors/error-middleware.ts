import type { ErrorRequestHandler } from "express";
import { sendFailure } from "../api-response";
import { AppError } from "../../shared/errors/app-error";
import { createLogger } from "../../shared/logger/logger";

const log = createLogger("http");

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  if (!(err instanceof AppError) || err.status >= 500) {
    log.error("request failed", {
      method: req.method,
      path: req.path,
      code: err instanceof AppError ? err.code : "INTERNAL_SERVER_ERROR",
      message: err instanceof Error ? err.message : String(err)
    });
  }

  if (err instanceof AppError) {
    return sendFailure(res, err.status, err.code, err.message, err.details);
  }

  return sendFailure(res, 500, "INTERNAL_SERVER_ERROR", "Internal server error");
};
