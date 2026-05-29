import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { ROUTE_KEYS, buildRateLimiters } from "../../shared/security/rate-limit-profiles";
import { runWithIdempotency } from "../../shared/security/idempotency";
import { getPaymentProvider, type WebhookEvent } from "./providers";
import { listEventPaymentsQuerySchema } from "./schemas";
import {
  createPendingPaymentForBooking,
  createPendingPaymentForOccurrence,
  createPendingPaymentForReservation,
  getPaymentById,
  listEventPayments,
  processPaymentWebhook,
  processReservationPaymentWebhook
} from "./service";
import type { Request, Response } from "express";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export const PAYMENT_WEBHOOK_SECRET_HEADER = "x-spole-payment-webhook-secret";
export const RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER = "x-spole-reservation-payment-webhook-secret";

async function handleWebhook(
  deps: AppDeps,
  req: Request,
  res: Response,
  legacySecretHeader: string,
  apply: (deps: AppDeps, event: WebhookEvent) => Promise<{ status: string }>
) {
  const provider = getPaymentProvider(deps.env);
  const parsed = provider.verifyAndParseWebhook({
    getHeader: (name) => req.get(name) ?? undefined,
    legacySecretValue: req.get(legacySecretHeader),
    body: req.body ?? {}
  });
  switch (parsed.kind) {
    case "forbidden":
      return sendFailure(res, 403, "WEBHOOK_FORBIDDEN", "Invalid webhook signature");
    case "invalid":
      return sendFailure(res, 400, "INVALID_WEBHOOK_PAYLOAD", "providerReference is required");
    case "unsupported_status":
      return sendFailure(res, 422, "UNSUPPORTED_WEBHOOK_STATUS", "Unsupported webhook status");
    case "ignore":
      return sendSuccess(res, { status: "ignored" });
    case "apply": {
      const data = await apply(deps, {
        providerReference: parsed.providerReference,
        status: parsed.status,
        paidAmount: parsed.paidAmount
      });
      return sendSuccess(res, data);
    }
  }
}

export function paymentsRoutes(deps: AppDeps) {
  const router = Router();
  const rateLimit = buildRateLimiters(deps);

  router.post("/payments/webhook", rateLimit.paymentWebhook, async (req, res, next) => {
    try {
      await handleWebhook(deps, req, res, PAYMENT_WEBHOOK_SECRET_HEADER, processPaymentWebhook);
    } catch (err) {
      next(err);
    }
  });

  router.post("/reservation-payments/webhook", rateLimit.reservationPaymentWebhook, async (req, res, next) => {
    try {
      await handleWebhook(deps, req, res, RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, processReservationPaymentWebhook);
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
    "/events/:eventId/payments",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = listEventPaymentsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
        }
        const { data, meta } = await listEventPayments(deps, req.params.eventId, req.auth!, parsed.data);
        return sendSuccess(res, data, meta);
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
