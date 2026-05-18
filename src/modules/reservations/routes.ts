import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { createReservationSchema } from "./schemas";
import {
  cancelReservation,
  createReservation,
  getReservationById,
  listMyReservations
} from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function reservationsRoutes(deps: AppDeps) {
  const router = Router();

  router.post(
    "/reservations",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = createReservationSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const created = await createReservation(deps, req.auth!.id, parsed.data);
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/reservations/me",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await listMyReservations(deps.pool, req.auth!.id);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/reservations/:id",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await getReservationById(deps, req.params.id, req.auth!);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    "/reservations/:id/cancel",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await cancelReservation(deps.pool, req.params.id, req.auth!);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
