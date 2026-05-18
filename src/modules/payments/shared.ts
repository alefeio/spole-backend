import { timingSafeEqual } from "node:crypto";

export const MOCK_PROVIDER = "mock-provider";
export const ALLOWED_METHODS = new Set(["PIX"]);

export function validateWebhookSecret(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !expected) return false;
  const a = Buffer.from(headerValue.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type CreatePaymentBody = {
  method: string;
  provider: string;
};

export function parseCreatePaymentBody(body: unknown): CreatePaymentBody {
  const b = body as CreatePaymentBody;
  return {
    method: typeof b.method === "string" ? b.method : "",
    provider: typeof b.provider === "string" ? b.provider : ""
  };
}

export function validatePaymentMethodProvider(method: string, provider: string) {
  const m = method.trim().toUpperCase();
  const p = provider.trim();
  if (!ALLOWED_METHODS.has(m)) {
    return { ok: false as const, code: "INVALID_PAYMENT_METHOD" as const };
  }
  if (p !== MOCK_PROVIDER) {
    return { ok: false as const, code: "INVALID_PAYMENT_PROVIDER" as const };
  }
  return { ok: true as const, method: m, provider: p };
}
