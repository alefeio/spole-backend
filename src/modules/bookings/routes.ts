import { Router } from "express";
import type { AppDeps } from "../../app";
import { sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { ROUTE_KEYS, buildRateLimiters } from "../../shared/security/rate-limit-profiles";
import { runWithIdempotency } from "../../shared/security/idempotency";
import { cancelBooking, createPaidBooking } from "./service";

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
