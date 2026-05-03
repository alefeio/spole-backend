import type { ErrorRequestHandler } from "express";
import { sendFailure } from "../api-response";
import { AppError } from "../../shared/errors/app-error";

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return sendFailure(res, err.status, err.code, err.message, err.details);
  }

  return sendFailure(res, 500, "INTERNAL_SERVER_ERROR", "Internal server error");
};
