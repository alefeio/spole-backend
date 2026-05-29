import { timingSafeEqual } from "node:crypto";
import type { Env } from "../../../shared/env/env";
import { AppError } from "../../../shared/errors/app-error";
import { createLogger } from "../../../shared/logger/logger";
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentDomainStatus,
  PaymentProvider,
  WebhookInput,
  WebhookParseResult
} from "./types";

const log = createLogger("payments.asaas");

function tokenMatches(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function mapAsaasEvent(event: string): PaymentDomainStatus | null {
  switch (event) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED":
      return "PAID";
    case "PAYMENT_OVERDUE":
      return "FAILED";
    case "PAYMENT_DELETED":
      return "CANCELLED";
    default:
      return null;
  }
}

/**
 * Adapter do gateway Asaas (cobrança Pix).
 *
 * Modo real: cria cobrança via API v3 e obtém o QR Code Pix (copia-e-cola + imagem).
 * Webhook: valida o header `asaas-access-token` contra `ASAAS_WEBHOOK_ACCESS_TOKEN`.
 *
 * Observação: o Asaas autentica o webhook por access token no header (não exige HMAC sobre raw body),
 * então o parsing de JSON global da aplicação é suficiente.
 */
export class AsaasPaymentProvider implements PaymentProvider {
  readonly name = "asaas" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookToken: string | undefined;
  private readonly defaultCustomerId: string | undefined;

  constructor(env: Env) {
    if (!env.asaasApiKey) {
      throw new AppError({
        status: 500,
        code: "PAYMENTS_PROVIDER_MISCONFIGURED",
        message: "ASAAS_API_KEY is required when PAYMENTS_PROVIDER=asaas"
      });
    }
    this.apiKey = env.asaasApiKey;
    this.webhookToken = env.asaasWebhookToken;
    this.defaultCustomerId = env.asaasDefaultCustomerId;
    this.baseUrl =
      env.paymentsEnvironment === "production"
        ? "https://api.asaas.com/v3"
        : "https://sandbox.asaas.com/api/v3";
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        access_token: this.apiKey
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      log.error("asaas request failed", { method, path, status: res.status });
      throw new AppError({
        status: 502,
        code: "PAYMENTS_PROVIDER_ERROR",
        message: "Payment provider request failed"
      });
    }
    return json as T;
  }

  async createPixCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const customerId = this.defaultCustomerId;
    if (!customerId) {
      throw new AppError({
        status: 500,
        code: "PAYMENTS_PROVIDER_MISCONFIGURED",
        message: "ASAAS_DEFAULT_CUSTOMER_ID is required to create charges in asaas mode"
      });
    }

    const dueAt = input.contextExpiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dueDate = dueAt.toISOString().slice(0, 10);

    const payment = await this.request<{ id: string }>("POST", "/payments", {
      customer: customerId,
      billingType: "PIX",
      value: input.amount,
      dueDate,
      description: input.description,
      externalReference: input.externalReference
    });

    const qr = await this.request<{ encodedImage?: string; payload?: string; expirationDate?: string }>(
      "GET",
      `/payments/${payment.id}/pixQrCode`
    );

    return {
      providerReference: payment.id,
      checkout: {
        pixCopyPaste: qr.payload ?? null,
        pixQrCode: qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null,
        paymentExpiresAt: qr.expirationDate ?? null
      }
    };
  }

  verifyAndParseWebhook(input: WebhookInput): WebhookParseResult {
    const token = input.getHeader("asaas-access-token");
    if (!tokenMatches(token, this.webhookToken)) {
      return { kind: "forbidden" };
    }
    const body = (input.body ?? {}) as {
      event?: unknown;
      payment?: { id?: unknown; status?: unknown; value?: unknown };
    };
    const paymentId = typeof body.payment?.id === "string" ? body.payment.id.trim() : "";
    if (!paymentId) {
      return { kind: "invalid" };
    }
    const event = typeof body.event === "string" ? body.event.trim().toUpperCase() : "";
    const mapped = mapAsaasEvent(event);
    if (!mapped) {
      return { kind: "ignore" };
    }
    const paidAmount = typeof body.payment?.value === "number" ? body.payment.value : undefined;
    return { kind: "apply", providerReference: paymentId, status: mapped, paidAmount };
  }
}
