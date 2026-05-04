import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireArenaOwnerOrAdmin } from "../../shared/middleware/require-arena-access";
import { createSpaceSchema } from "./schemas";
import { createSpace, listSpacesByArena } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function spacesRoutes(deps: AppDeps) {
  const router = Router();

  router.get("/arenas/:arenaId/spaces", async (req, res, next) => {
    try {
      const rows = await listSpacesByArena(deps.pool, req.params.arenaId);
      return sendSuccess(res, rows);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/arenas/:arenaId/spaces",
    requireAuth(deps),
    requireArenaOwnerOrAdmin(deps, "arenaId"),
    async (req, res, next) => {
      try {
        const parsed = createSpaceSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const row = await createSpace(deps.pool, req.params.arenaId, parsed.data);
        return sendSuccess(res, row, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
