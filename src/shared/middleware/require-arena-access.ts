import type { NextFunction, Request, Response } from "express";
import type { AppDeps } from "../../app";
import { sendFailure } from "../../http/api-response";

export function requireArenaOwnerOrAdmin(deps: AppDeps, paramName: "id" | "arenaId" = "id") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) {
      return sendFailure(res, 401, "UNAUTHORIZED", "Unauthorized");
    }

    const arenaId = req.params[paramName];
    if (!arenaId) {
      return sendFailure(res, 400, "VALIDATION_ERROR", "Missing arena id");
    }

    if (auth.role === "admin") {
      return next();
    }

    const r = await deps.pool.query<{ owner_id: string }>(
      `SELECT owner_id FROM arenas WHERE id = $1 LIMIT 1`,
      [arenaId]
    );
    const row = r.rows[0];
    if (!row) {
      return sendFailure(res, 404, "ARENA_NOT_FOUND", "Arena not found");
    }

    if (row.owner_id !== auth.id) {
      return sendFailure(res, 403, "FORBIDDEN", "Forbidden");
    }

    return next();
  };
}

export function requireSpaceManageAccess(deps: AppDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) {
      return sendFailure(res, 401, "UNAUTHORIZED", "Unauthorized");
    }

    const spaceId = req.params.spaceId;
    if (!spaceId) {
      return sendFailure(res, 400, "VALIDATION_ERROR", "Missing space id");
    }

    if (auth.role === "admin") {
      return next();
    }

    const r = await deps.pool.query<{ owner_id: string }>(
      `
        SELECT a.owner_id
        FROM arena_spaces s
        INNER JOIN arenas a ON a.id = s.arena_id
        WHERE s.id = $1
        LIMIT 1
      `,
      [spaceId]
    );
    const row = r.rows[0];
    if (!row) {
      return sendFailure(res, 404, "SPACE_NOT_FOUND", "Space not found");
    }

    if (row.owner_id !== auth.id) {
      return sendFailure(res, 403, "FORBIDDEN", "Forbidden");
    }

    return next();
  };
}
