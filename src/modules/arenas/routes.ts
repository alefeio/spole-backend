import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireArenaOwnerOrAdmin } from "../../shared/middleware/require-arena-access";
import { requireRoles } from "../../shared/middleware/require-roles";
import { listArenaReservations } from "../reservations/service";
import { listSlotsByArena } from "../slots/service";
import { listSlotsQuerySchema } from "../slots/schemas";
import { createArenaSchema, patchArenaSchema } from "./schemas";
import { createArena, getArenaById, updateArena } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function arenasRoutes(deps: AppDeps) {
  const router = Router();

  router.get(
    "/arenas/:arenaId/reservations",
    requireAuth(deps),
    requireArenaOwnerOrAdmin(deps, "arenaId"),
    async (req, res, next) => {
      try {
        const data = await listArenaReservations(deps.pool, req.params.arenaId);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/arenas/:arenaId/slots", async (req, res, next) => {
    try {
      const parsed = listSlotsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listSlotsByArena(deps.pool, req.params.arenaId, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/arenas",
    requireAuth(deps),
    requireRoles(["arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = createArenaSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const created = await createArena(deps.pool, req.auth!.id, parsed.data);
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/arenas/:id", async (req, res, next) => {
    try {
      const arena = await getArenaById(deps.pool, req.params.id);
      return sendSuccess(res, arena);
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    "/arenas/:id",
    requireAuth(deps),
    requireArenaOwnerOrAdmin(deps, "id"),
    async (req, res, next) => {
      try {
        const parsed = patchArenaSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const updated = await updateArena(deps.pool, req.params.id, parsed.data);
        return sendSuccess(res, updated);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
