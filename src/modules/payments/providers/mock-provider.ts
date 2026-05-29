import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import type { Env } from "../../../shared/env/env";
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  WebhookInput,
  WebhookParseResult
} from "./types";

function secretMatches(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !expected) return false;
  const a = Buffer.from(headerValue.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Provedor mock — preserva o fluxo legado para dev/testes/CI.
 *
 * - `createPixCharge`: gera um `providerReference` local (UUID) e dados de checkout Pix simulados.
 * - `verifyAndParseWebhook`: aceita o payload legado `{ providerReference, status }` com o header
 *   `X-Spole-*-Webhook-Secret` validado contra `PAYMENTS_WEBHOOK_SECRET`.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;

  constructor(private readonly env: Env) {}

  async createPixCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const providerReference = randomUUID();
    const paymentExpiresAt = input.contextExpiresAt ? input.contextExpiresAt.toISOString() : null;
    const emv = `00020126MOCK-PIX-${providerReference}5204000053039865802BR6009SPOLE-DEV`;
    return {
      providerReference,
      checkout: {
        pixCopyPaste: emv,
        pixQrCode: `data:image/png;base64,MOCKQR-${providerReference}`,
        paymentExpiresAt
      }
    };
  }

  verifyAndParseWebhook(input: WebhookInput): WebhookParseResult {
    if (!secretMatches(input.legacySecretValue, this.env.paymentsWebhookSecret)) {
      return { kind: "forbidden" };
    }
    const body = (input.body ?? {}) as { providerReference?: unknown; status?: unknown };
    const ref = typeof body.providerReference === "string" ? body.providerReference.trim() : "";
    if (!ref) {
      return { kind: "invalid" };
    }
    const statusRaw = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
    if (statusRaw === "PAID" || statusRaw === "FAILED" || statusRaw === "CANCELLED") {
      return { kind: "apply", providerReference: ref, status: statusRaw };
    }
    return { kind: "unsupported_status" };
  }
}
