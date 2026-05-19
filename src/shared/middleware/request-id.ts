import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { requestContext } from "../context/request-context";

export const REQUEST_ID_HEADER = "x-request-id";

const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function normalizeRequestId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed && trimmed.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return randomUUID();
}

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = normalizeRequestId(req.get(REQUEST_ID_HEADER) ?? undefined);
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContext.run({ requestId }, () => next());
  };
}
