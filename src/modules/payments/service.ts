import { randomUUID } from "node:crypto";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import type { PaginationMeta, PaginationQuery } from "../../shared/http/pagination";
import { createLogger } from "../../shared/logger/logger";
import type { AuthUser } from "../../types/auth";
import { bookingRedisKey } from "../bookings/booking-redis";
import { expireStaleBookings } from "../bookings/service";
import { insertNotification } from "../notifications/service";
import { validatePaymentMethodProvider, type CreatePaymentBody } from "./shared";

export { validateWebhookSecret, type CreatePaymentBody } from "./shared";
export {
  createPendingPaymentForReservation,
  createPendingPaymentForOccurrence,
  processReservationPaymentWebhook
} from "./reservation-payments";

const log = createLogger("payments");

export async function createPendingPaymentForBooking(
  deps: AppDeps,
  auth: AuthUser,
  bookingId: string,
  body: CreatePaymentBody
) {
  const { pool } = deps;
  const parsed = validatePaymentMethodProvider(
    typeof body.method === "string" ? body.method : "",
    typeof body.provider === "string" ? body.provider : ""
  );
  if (!parsed.ok) {
    throw new AppError({
      status: 422,
      code: parsed.code,
      message: parsed.code === "INVALID_PAYMENT_METHOD" ? "Unsupported payment method" : "Unsupported payment provider"
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bRes = await client.query<{
      id: string;
      event_id: string;
      user_id: string;
      status: string;
      expires_at: string;
    }>(
      `
        SELECT id, event_id, user_id, status::text, expires_at
        FROM bookings
        WHERE id = $1
        FOR UPDATE
      `,
      [bookingId]
    );
    const booking = bRes.rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
    }
    if (auth.role !== "admin" && booking.user_id !== auth.id) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
    }

    await expireStaleBookings(client, deps.redis, { eventId: booking.event_id });

    const b2 = await client.query<{ status: string; expires_at: string }>(
      `SELECT status::text, expires_at FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    const st = b2.rows[0]?.status;
    const expiresAt = b2.rows[0]?.expires_at;
    if (st !== "RESERVED") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "BOOKING_NOT_PAYABLE",
        message: "Booking is not open for payment"
      });
    }
    if (!expiresAt || new Date(expiresAt) <= new Date()) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "BOOKING_EXPIRED",
        message: "Booking has expired"
      });
    }

    const ev = await client.query<{ type: string; price_per_person: string }>(
      `SELECT type::text, price_per_person::text FROM events WHERE id = $1`,
      [booking.event_id]
    );
    const evRow = ev.rows[0];
    if (!evRow || evRow.type !== "PAID") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "EVENT_NOT_PAID",
        message: "Payments are only for paid events"
      });
    }

    const gross = Number(evRow.price_per_person);
    if (!Number.isFinite(gross) || gross < 0) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "INVALID_EVENT_PRICE",
        message: "Event price is invalid for payment"
      });
    }
    const feeAmount = 0;
    const netAmount = gross - feeAmount;

    const providerReference = randomUUID();

    const ins = await client.query<{
      id: string;
      booking_id: string;
      status: string;
      method: string;
      provider: string;
      provider_reference: string;
      gross_amount: string;
      fee_amount: string;
      net_amount: string;
    }>(
      `
        INSERT INTO payments (
          user_id, booking_id, method, provider, provider_reference,
          gross_amount, fee_amount, net_amount, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
        RETURNING id, booking_id, status::text, method, provider, provider_reference,
          gross_amount::text, fee_amount::text, net_amount::text
      `,
      [booking.user_id, bookingId, parsed.method, parsed.provider, providerReference, gross, feeAmount, netAmount]
    );

    const row = ins.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "PAYMENT_CREATE_FAILED", message: "Payment create failed" });
    }

    await client.query("COMMIT");

    return {
      id: row.id,
      bookingId: row.booking_id,
      status: row.status as "PENDING",
      method: row.method,
      provider: row.provider,
      providerReference: row.provider_reference,
      grossAmount: Number(row.gross_amount),
      feeAmount: Number(row.fee_amount),
      netAmount: Number(row.net_amount)
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "PAYMENT_ALREADY_EXISTS",
        message: "A payment already exists for this booking"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export type WebhookBody = {
  providerReference?: string;
  status?: string;
};

export async function processPaymentWebhook(deps: AppDeps, body: WebhookBody) {
  const ref = typeof body.providerReference === "string" ? body.providerReference.trim() : "";
  const statusRaw = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  if (!ref) {
    throw new AppError({ status: 400, code: "INVALID_WEBHOOK_PAYLOAD", message: "providerReference is required" });
  }
  if (statusRaw !== "PAID") {
    throw new AppError({ status: 422, code: "UNSUPPORTED_WEBHOOK_STATUS", message: "Unsupported webhook status" });
  }

  const { pool, redis } = deps;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pRes = await client.query<{
      id: string;
      user_id: string;
      booking_id: string;
      status: string;
    }>(
      `
        SELECT id, user_id, booking_id, status::text
        FROM payments
        WHERE provider_reference = $1
          AND booking_id IS NOT NULL
        FOR UPDATE
      `,
      [ref]
    );
    const pay = pRes.rows[0];
    if (!pay) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "PAYMENT_NOT_FOUND", message: "Payment not found" });
    }
    if (!pay.booking_id) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "PAYMENT_NOT_FOUND", message: "Payment not found" });
    }

    if (pay.status === "PAID") {
      await client.query("COMMIT");
      return { status: "processed" as const };
    }

    if (pay.status !== "PENDING") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "PAYMENT_STATE_CONFLICT",
        message: "Payment cannot be confirmed in its current state"
      });
    }

    const bRes = await client.query<{
      id: string;
      event_id: string;
      user_id: string;
      status: string;
      expires_at: string;
    }>(
      `
        SELECT id, event_id, user_id, status::text, expires_at
        FROM bookings
        WHERE id = $1
        FOR UPDATE
      `,
      [pay.booking_id]
    );
    const booking = bRes.rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
    }

    await expireStaleBookings(client, redis, { eventId: booking.event_id });

    const b2 = await client.query<{ status: string; expires_at: string; user_id: string }>(
      `SELECT status::text, expires_at, user_id FROM bookings WHERE id = $1 FOR UPDATE`,
      [pay.booking_id]
    );
    const bRow = b2.rows[0];
    if (!bRow || bRow.user_id !== pay.user_id) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 422, code: "PAYMENT_BOOKING_MISMATCH", message: "Booking does not match payment" });
    }
    if (bRow.status !== "RESERVED") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "PAYMENT_CANNOT_COMPLETE",
        message: "Booking is no longer active; payment cannot complete purchase"
      });
    }
    if (!bRow.expires_at || new Date(bRow.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "PAYMENT_CANNOT_COMPLETE",
        message: "Booking has expired; payment cannot complete purchase"
      });
    }

    const updPay = await client.query(
      `
        UPDATE payments
        SET status = 'PAID', paid_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'PENDING'
      `,
      [pay.id]
    );
    if (updPay.rowCount !== 1) {
      await client.query("ROLLBACK");
      const again = await pool.query<{ status: string }>(
        `SELECT status::text FROM payments WHERE id = $1`,
        [pay.id]
      );
      if (again.rows[0]?.status === "PAID") {
        return { status: "processed" as const };
      }
      throw new AppError({ status: 409, code: "PAYMENT_STATE_CONFLICT", message: "Payment update conflict" });
    }

    const updBk = await client.query(
      `
        UPDATE bookings
        SET
          status = 'COMPLETED',
          purchase_completed_at = now(),
          updated_at = now()
        WHERE id = $1 AND status = 'RESERVED'
      `,
      [pay.booking_id]
    );
    if (updBk.rowCount !== 1) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "BOOKING_CONFIRM_CONFLICT",
        message: "Booking could not be completed"
      });
    }

    await client.query(
      `
        INSERT INTO event_participants (event_id, user_id, status)
        VALUES ($1, $2, 'CONFIRMED')
      `,
      [booking.event_id, pay.user_id]
    );

    const evRes = await client.query<{ title: string }>(`SELECT title FROM events WHERE id = $1`, [
      booking.event_id
    ]);
    const eventTitle = evRes.rows[0]?.title ?? "evento";
    const notifId = await insertNotification(client, {
      userId: pay.user_id,
      title: "Pagamento confirmado",
      message: `Sua vaga foi confirmada no evento "${eventTitle}".`,
      type: "PAYMENT_CONFIRMED"
    });

    await client.query("COMMIT");

    const rk = bookingRedisKey(pay.booking_id);
    await redis.del(rk).catch(() => undefined);

    log.info("payment confirmed", { paymentId: pay.id, bookingId: pay.booking_id, notificationId: notifId });

    return { status: "processed" as const };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "PARTICIPANT_ALREADY_EXISTS",
        message: "Participant already registered for this event"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyPayments(deps: AppDeps, auth: AuthUser, query: PaginationQuery) {
  const countRes = await deps.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM payments WHERE user_id = $1`,
    [auth.id]
  );
  const total = Number(countRes.rows[0]?.count ?? 0);
  const offset = (query.page - 1) * query.limit;

  const res = await deps.pool.query<{
    id: string;
    booking_id: string | null;
    reservation_id: string | null;
    reservation_occurrence_id: string | null;
    status: string;
    method: string;
    provider: string;
    gross_amount: string;
    fee_amount: string;
    net_amount: string;
    paid_at: string | null;
    created_at: string;
  }>(
    `
      SELECT id, booking_id, reservation_id, reservation_occurrence_id, status::text, method, provider,
        gross_amount::text, fee_amount::text, net_amount::text,
        paid_at, created_at
      FROM payments
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [auth.id, query.limit, offset]
  );

  return {
    data: res.rows.map((r) => ({
      id: r.id,
      bookingId: r.booking_id,
      reservationId: r.reservation_id,
      reservationOccurrenceId: r.reservation_occurrence_id,
      status: r.status,
      method: r.method,
      provider: r.provider,
      grossAmount: Number(r.gross_amount),
      feeAmount: Number(r.fee_amount),
      netAmount: Number(r.net_amount),
      paidAt: r.paid_at,
      createdAt: r.created_at
    })),
    meta: { page: query.page, limit: query.limit, total } satisfies PaginationMeta
  };
}

export async function getPaymentById(deps: AppDeps, auth: AuthUser, paymentId: string) {
  const res = await deps.pool.query<{
    id: string;
    user_id: string;
    booking_id: string | null;
    reservation_id: string | null;
    reservation_occurrence_id: string | null;
    status: string;
    method: string;
    provider: string;
    provider_reference: string;
    gross_amount: string;
    fee_amount: string;
    net_amount: string;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, user_id, booking_id, reservation_id, reservation_occurrence_id, status::text, method, provider,
        provider_reference, gross_amount::text, fee_amount::text, net_amount::text,
        paid_at, created_at, updated_at
      FROM payments
      WHERE id = $1
    `,
    [paymentId]
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError({ status: 404, code: "PAYMENT_NOT_FOUND", message: "Payment not found" });
  }
  if (auth.role !== "admin" && row.user_id !== auth.id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }
  return {
    id: row.id,
    userId: row.user_id,
    bookingId: row.booking_id,
    reservationId: row.reservation_id,
    reservationOccurrenceId: row.reservation_occurrence_id,
    status: row.status,
    method: row.method,
    provider: row.provider,
    providerReference: row.provider_reference,
    grossAmount: Number(row.gross_amount),
    feeAmount: Number(row.fee_amount),
    netAmount: Number(row.net_amount),
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
