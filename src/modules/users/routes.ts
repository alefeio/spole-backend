import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { paginationQuerySchema } from "../../shared/http/pagination";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { listMyBookings } from "../bookings/service";
import { listMyParticipants } from "../event-participants/service";
import { listMyNotifications } from "../notifications/service";
import { listMyPayments } from "../payments/service";
import { getMe } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function usersRoutes(deps: AppDeps) {
  const router = Router();

  router.get(
    "/users/me",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const auth = req.auth!;
        const user = await getMe(deps.pool, auth.id);
        return sendSuccess(res, {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/users/me/participants",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await listMyParticipants(deps, req.auth!);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/users/me/notifications",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = paginationQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
        }
        const { data, meta } = await listMyNotifications(deps, req.auth!, parsed.data);
        return sendSuccess(res, data, meta);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/users/me/bookings",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = paginationQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
        }
        const { data, meta } = await listMyBookings(deps, req.auth!, parsed.data);
        return sendSuccess(res, data, meta);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/users/me/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = paginationQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
        }
        const { data, meta } = await listMyPayments(deps, req.auth!, parsed.data);
        return sendSuccess(res, data, meta);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
