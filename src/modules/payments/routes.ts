import { Router } from "express";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
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

  router.post("/payments/webhook", async (req, res, next) => {
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

  router.post("/reservation-payments/webhook", async (req, res, next) => {
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
    async (req, res, next) => {
      try {
        const created = await createPendingPaymentForBooking(deps, req.auth!, req.params.bookingId, req.body ?? {});
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/reservations/:reservationId/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const created = await createPendingPaymentForReservation(
          deps,
          req.auth!,
          req.params.reservationId,
          req.body ?? {}
        );
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/reservation-occurrences/:occurrenceId/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const created = await createPendingPaymentForOccurrence(
          deps,
          req.auth!,
          req.params.occurrenceId,
          req.body ?? {}
        );
        return sendSuccess(res, created, undefined, 201);
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
