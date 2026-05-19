import { Router } from "express";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { ROUTE_KEYS, buildRateLimiters } from "../../shared/security/rate-limit-profiles";
import { runWithIdempotency } from "../../shared/security/idempotency";
import {
  createPendingPaymentForBooking,
  createPendingPaymentForOccurrence,
  createPendingPaymentForReservation,
  getPaymentById,
  processPaymentWebhook,
  processReservationPaymentWebhook,
  validateWebhookSecret
} from "./service";

export const PAYMENT_WEBHOOK_SECRET_HEADER = "x-spole-payment-webhook-secret";
export const RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER = "x-spole-reservation-payment-webhook-secret";

export function paymentsRoutes(deps: AppDeps) {
  const router = Router();
  const rateLimit = buildRateLimiters(deps);

  router.post("/payments/webhook", rateLimit.paymentWebhook, async (req, res, next) => {
    try {
      const header = req.get(PAYMENT_WEBHOOK_SECRET_HEADER);
      if (!validateWebhookSecret(header, deps.env.paymentsWebhookSecret)) {
        return sendFailure(res, 403, "WEBHOOK_FORBIDDEN", "Invalid webhook secret");
      }
      const data = await processPaymentWebhook(deps, req.body ?? {});
      return sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.post("/reservation-payments/webhook", rateLimit.reservationPaymentWebhook, async (req, res, next) => {
    try {
      const header = req.get(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER);
      if (!validateWebhookSecret(header, deps.env.paymentsWebhookSecret)) {
        return sendFailure(res, 403, "WEBHOOK_FORBIDDEN", "Invalid webhook secret");
      }
      const data = await processReservationPaymentWebhook(deps, req.body ?? {});
      return sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/bookings/:bookingId/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    rateLimit.createBookingPayment,
    async (req, res, next) => {
      try {
        await runWithIdempotency(deps, req, res, {
          method: "POST",
          routeTemplate: ROUTE_KEYS.createBookingPayment,
          userId: req.auth!.id,
          execute: async () => {
            const created = await createPendingPaymentForBooking(
              deps,
              req.auth!,
              req.params.bookingId,
              req.body ?? {}
            );
            return { status: 201, data: created };
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/reservations/:reservationId/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    rateLimit.createReservationPayment,
    async (req, res, next) => {
      try {
        await runWithIdempotency(deps, req, res, {
          method: "POST",
          routeTemplate: ROUTE_KEYS.createReservationPayment,
          userId: req.auth!.id,
          execute: async () => {
            const created = await createPendingPaymentForReservation(
              deps,
              req.auth!,
              req.params.reservationId,
              req.body ?? {}
            );
            return { status: 201, data: created };
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/reservation-occurrences/:occurrenceId/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    rateLimit.createOccurrencePayment,
    async (req, res, next) => {
      try {
        await runWithIdempotency(deps, req, res, {
          method: "POST",
          routeTemplate: ROUTE_KEYS.createOccurrencePayment,
          userId: req.auth!.id,
          execute: async () => {
            const created = await createPendingPaymentForOccurrence(
              deps,
              req.auth!,
              req.params.occurrenceId,
              req.body ?? {}
            );
            return { status: 201, data: created };
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/payments/:id",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await getPaymentById(deps, req.auth!, req.params.id);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
