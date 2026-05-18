import { randomUUID } from "node:crypto";
import type { AppDeps } from "../../app";
import { AppError } from "../../shared/errors/app-error";
import { createLogger } from "../../shared/logger/logger";
import type { AuthUser } from "../../types/auth";
import { confirmOccurrenceInTransaction, confirmReservationInTransaction } from "../reservations/confirm";
import { expireStaleReservations } from "../reservations/expire";
import { releaseStaleReservationOccurrences } from "../reservations/recurrence";
import {
  ALLOWED_METHODS,
  MOCK_PROVIDER,
  parseCreatePaymentBody,
  validatePaymentMethodProvider,
  type CreatePaymentBody
} from "./shared";

const log = createLogger("reservation-payments");

export type WebhookBody = {
  providerReference?: string;
  status?: string;
};

async function runReservationMaintenance(client: import("pg").PoolClient) {
  await expireStaleReservations(client);
  await releaseStaleReservationOccurrences(client);
}

export async function createPendingPaymentForReservation(
  deps: AppDeps,
  auth: AuthUser,
  reservationId: string,
  body: CreatePaymentBody
) {
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

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    await runReservationMaintenance(client);

    const rRes = await client.query<{
      id: string;
      organizer_id: string;
      status: string;
      required_payment_amount: string;
      expires_at: string | null;
    }>(
      `
        SELECT id, organizer_id, status::text, required_payment_amount::text, expires_at
        FROM reservations
        WHERE id = $1
        FOR UPDATE
      `,
      [reservationId]
    );
    const reservation = rRes.rows[0];
    if (!reservation) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
    }
    if (auth.role !== "admin" && reservation.organizer_id !== auth.id) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
    }
    if (reservation.status !== "PENDING") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "RESERVATION_NOT_PAYABLE",
        message: "Reservation is not open for payment"
      });
    }
    if (reservation.expires_at && new Date(reservation.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "RESERVATION_EXPIRED",
        message: "Reservation has expired"
      });
    }

    const gross = Number(reservation.required_payment_amount);
    if (!Number.isFinite(gross) || gross <= 0) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "RESERVATION_NO_PAYMENT_REQUIRED",
        message: "Reservation does not require payment"
      });
    }

    const feeAmount = 0;
    const netAmount = gross - feeAmount;
    const providerReference = randomUUID();

    const ins = await client.query<{
      id: string;
      reservation_id: string;
      status: string;
      provider_reference: string;
    }>(
      `
        INSERT INTO payments (
          user_id, reservation_id, method, provider, provider_reference,
          gross_amount, fee_amount, net_amount, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
        RETURNING id, reservation_id, status::text, provider_reference
      `,
      [
        reservation.organizer_id,
        reservationId,
        parsed.method,
        parsed.provider,
        providerReference,
        gross,
        feeAmount,
        netAmount
      ]
    );
    const row = ins.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "PAYMENT_CREATE_FAILED", message: "Payment create failed" });
    }

    await client.query("COMMIT");
    return {
      id: row.id,
      reservationId: row.reservation_id,
      status: row.status as "PENDING",
      method: parsed.method,
      provider: parsed.provider,
      providerReference: row.provider_reference,
      grossAmount: gross,
      feeAmount,
      netAmount
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "PAYMENT_ALREADY_EXISTS",
        message: "A payment already exists for this reservation"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function createPendingPaymentForOccurrence(
  deps: AppDeps,
  auth: AuthUser,
  occurrenceId: string,
  body: CreatePaymentBody
) {
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

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    await runReservationMaintenance(client);

    const oRes = await client.query<{
      id: string;
      status: string;
      due_at: string;
      slot_id: string;
      organizer_id: string;
      price: string;
      min_percent: number;
    }>(
      `
        SELECT
          o.id,
          o.status::text,
          o.due_at,
          o.slot_id,
          r.organizer_id,
          s.price::text,
          p.min_reservation_payment_percent AS min_percent
        FROM reservation_occurrences o
        INNER JOIN reservation_recurrences rr ON rr.id = o.recurrence_id
        INNER JOIN reservations r ON r.id = rr.reservation_id
        INNER JOIN arena_slots s ON s.id = o.slot_id
        INNER JOIN arena_spaces sp ON sp.id = s.space_id
        INNER JOIN arena_policies p ON p.arena_id = sp.arena_id
        WHERE o.id = $1
        FOR UPDATE OF o
      `,
      [occurrenceId]
    );
    const occ = oRes.rows[0];
    if (!occ) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "OCCURRENCE_NOT_FOUND", message: "Reservation occurrence not found" });
    }
    if (auth.role !== "admin" && occ.organizer_id !== auth.id) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
    }
    if (occ.status !== "PENDING_PAYMENT") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "OCCURRENCE_NOT_PAYABLE",
        message: "Occurrence is not open for payment"
      });
    }
    if (new Date(occ.due_at) <= new Date()) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 409,
        code: "OCCURRENCE_PAYMENT_DEADLINE_PASSED",
        message: "Occurrence payment deadline has passed"
      });
    }

    const slotPrice = Number(occ.price);
    const gross = (slotPrice * occ.min_percent) / 100;
    if (!Number.isFinite(gross) || gross <= 0) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "OCCURRENCE_NO_PAYMENT_REQUIRED",
        message: "Occurrence does not require payment"
      });
    }

    const feeAmount = 0;
    const netAmount = gross - feeAmount;
    const providerReference = randomUUID();

    const ins = await client.query<{
      id: string;
      reservation_occurrence_id: string;
      status: string;
      provider_reference: string;
    }>(
      `
        INSERT INTO payments (
          user_id, reservation_occurrence_id, method, provider, provider_reference,
          gross_amount, fee_amount, net_amount, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
        RETURNING id, reservation_occurrence_id, status::text, provider_reference
      `,
      [
        occ.organizer_id,
        occurrenceId,
        parsed.method,
        parsed.provider,
        providerReference,
        gross,
        feeAmount,
        netAmount
      ]
    );
    const row = ins.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "PAYMENT_CREATE_FAILED", message: "Payment create failed" });
    }

    await client.query("COMMIT");
    return {
      id: row.id,
      reservationOccurrenceId: row.reservation_occurrence_id,
      status: row.status as "PENDING",
      method: parsed.method,
      provider: parsed.provider,
      providerReference: row.provider_reference,
      grossAmount: gross,
      feeAmount,
      netAmount
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof AppError) throw err;
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError({
        status: 409,
        code: "PAYMENT_ALREADY_EXISTS",
        message: "A payment already exists for this occurrence"
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function processReservationPaymentWebhook(deps: AppDeps, body: WebhookBody) {
  const ref = typeof body.providerReference === "string" ? body.providerReference.trim() : "";
  const statusRaw = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  if (!ref) {
    throw new AppError({ status: 400, code: "INVALID_WEBHOOK_PAYLOAD", message: "providerReference is required" });
  }
  if (statusRaw !== "PAID") {
    throw new AppError({ status: 422, code: "UNSUPPORTED_WEBHOOK_STATUS", message: "Unsupported webhook status" });
  }

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    await runReservationMaintenance(client);

    const pRes = await client.query<{
      id: string;
      user_id: string;
      reservation_id: string | null;
      reservation_occurrence_id: string | null;
      status: string;
      gross_amount: string;
    }>(
      `
        SELECT id, user_id, reservation_id, reservation_occurrence_id, status::text, gross_amount::text
        FROM payments
        WHERE provider_reference = $1
          AND booking_id IS NULL
        FOR UPDATE
      `,
      [ref]
    );
    const pay = pRes.rows[0];
    if (!pay) {
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

    if (pay.reservation_id) {
      const r = await client.query<{ status: string; expires_at: string | null; required_payment_amount: string }>(
        `SELECT status::text, expires_at, required_payment_amount::text FROM reservations WHERE id = $1 FOR UPDATE`,
        [pay.reservation_id]
      );
      const resv = r.rows[0];
      if (!resv || resv.status !== "PENDING") {
        await client.query("ROLLBACK");
        throw new AppError({
          status: 422,
          code: "PAYMENT_CANNOT_COMPLETE",
          message: "Reservation is no longer payable"
        });
      }
      if (resv.expires_at && new Date(resv.expires_at) <= new Date()) {
        await client.query("ROLLBACK");
        throw new AppError({
          status: 422,
          code: "PAYMENT_CANNOT_COMPLETE",
          message: "Reservation has expired"
        });
      }

      const updPay = await client.query(
        `UPDATE payments SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'PENDING'`,
        [pay.id]
      );
      if (updPay.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { status: "processed" as const };
      }

      await confirmReservationInTransaction(client, pay.reservation_id, Number(pay.gross_amount));
      await client.query("COMMIT");
      log.info("reservation payment confirmed", {
        paymentId: pay.id,
        reservationId: pay.reservation_id
      });
      return { status: "processed" as const };
    }

    if (pay.reservation_occurrence_id) {
      const o = await client.query<{ status: string; due_at: string }>(
        `SELECT status::text, due_at FROM reservation_occurrences WHERE id = $1 FOR UPDATE`,
        [pay.reservation_occurrence_id]
      );
      const occ = o.rows[0];
      if (!occ || occ.status !== "PENDING_PAYMENT") {
        await client.query("ROLLBACK");
        throw new AppError({
          status: 422,
          code: "PAYMENT_CANNOT_COMPLETE",
          message: "Occurrence is no longer payable"
        });
      }
      if (new Date(occ.due_at) <= new Date()) {
        await client.query("ROLLBACK");
        throw new AppError({
          status: 422,
          code: "PAYMENT_CANNOT_COMPLETE",
          message: "Occurrence payment deadline has passed"
        });
      }

      const updPay = await client.query(
        `UPDATE payments SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'PENDING'`,
        [pay.id]
      );
      if (updPay.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { status: "processed" as const };
      }

      await confirmOccurrenceInTransaction(client, pay.reservation_occurrence_id);
      await client.query("COMMIT");
      log.info("occurrence payment confirmed", {
        paymentId: pay.id,
        occurrenceId: pay.reservation_occurrence_id
      });
      return { status: "processed" as const };
    }

    await client.query("ROLLBACK");
    throw new AppError({ status: 422, code: "PAYMENT_CONTEXT_INVALID", message: "Invalid reservation payment context" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export { ALLOWED_METHODS, MOCK_PROVIDER, parseCreatePaymentBody };
