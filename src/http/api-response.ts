import type { Response } from "express";

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
};

export function sendSuccess<T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>
) {
  const payload: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return res.json(payload);
}

export function sendFailure(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown[]
) {
  const payload: ApiFailure = {
    success: false,
    error: { code, message, details }
  };
  return res.status(status).json(payload);
}
