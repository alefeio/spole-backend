import type { AppDeps } from "../../app";
import { createRateLimitMiddleware } from "./rate-limit";

export const ROUTE_KEYS = {
  authLogin: "POST /auth/login",
  authRegister: "POST /auth/register",
  publicEvents: "GET /events",
  createBooking: "POST /events/:eventId/bookings",
  createBookingPayment: "POST /bookings/:bookingId/payments",
  createReservationPayment: "POST /reservations/:reservationId/payments",
  createOccurrencePayment: "POST /reservation-occurrences/:occurrenceId/payments",
  paymentWebhook: "POST /payments/webhook",
  reservationPaymentWebhook: "POST /reservation-payments/webhook"
} as const;

export function buildRateLimiters(deps: AppDeps) {
  const { env } = deps;
  return {
    authLogin: createRateLimitMiddleware(deps, "auth", ROUTE_KEYS.authLogin, env.rateLimitAuth),
    authRegister: createRateLimitMiddleware(deps, "auth", ROUTE_KEYS.authRegister, env.rateLimitAuth),
    publicEvents: createRateLimitMiddleware(deps, "publicRead", ROUTE_KEYS.publicEvents, env.rateLimitPublicRead),
    createBooking: createRateLimitMiddleware(
      deps,
      "authenticated",
      ROUTE_KEYS.createBooking,
      env.rateLimitAuthenticated
    ),
    createBookingPayment: createRateLimitMiddleware(
      deps,
      "authenticated",
      ROUTE_KEYS.createBookingPayment,
      env.rateLimitAuthenticated
    ),
    createReservationPayment: createRateLimitMiddleware(
      deps,
      "authenticated",
      ROUTE_KEYS.createReservationPayment,
      env.rateLimitAuthenticated
    ),
    createOccurrencePayment: createRateLimitMiddleware(
      deps,
      "authenticated",
      ROUTE_KEYS.createOccurrencePayment,
      env.rateLimitAuthenticated
    ),
    paymentWebhook: createRateLimitMiddleware(deps, "publicRead", ROUTE_KEYS.paymentWebhook, env.rateLimitWebhook),
    reservationPaymentWebhook: createRateLimitMiddleware(
      deps,
      "publicRead",
      ROUTE_KEYS.reservationPaymentWebhook,
      env.rateLimitWebhook
    )
  };
}
