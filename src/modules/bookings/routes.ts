import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { ROUTE_KEYS, buildRateLimiters } from "../../shared/security/rate-limit-profiles";
import { runWithIdempotency } from "../../shared/security/idempotency";
import { listEventBookingsQuerySchema } from "./schemas";
import { cancelBooking, createPaidBooking, listEventBookings } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function bookingsRoutes(deps: AppDeps) {
  const router = Router();
  const rateLimit = buildRateLimiters(deps);

  router.post(
    "/events/:eventId/bookings",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    rateLimit.createBooking,
    async (req, res, next) => {
      try {
        const raw = req.query.privateCode;
        const privateCode = typeof raw === "string" ? raw : undefined;
        await runWithIdempotency(deps, req, res, {
          method: "POST",
          routeTemplate: ROUTE_KEYS.createBooking,
          userId: req.auth!.id,
          execute: async () => {
            const created = await createPaidBooking(deps, req.auth!, req.params.eventId, privateCode);
            return { status: 201, data: created };
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/events/:eventId/bookings",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = listEventBookingsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
        }
        const { data, meta } = await listEventBookings(deps, req.params.eventId, req.auth!, parsed.data);
        return sendSuccess(res, data, meta);
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    "/bookings/:id/cancel",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await cancelBooking(deps, req.params.id, req.auth!);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
