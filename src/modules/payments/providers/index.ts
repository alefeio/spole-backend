import type { Env } from "../../../shared/env/env";
import { AsaasPaymentProvider } from "./asaas-provider";
import { MockPaymentProvider } from "./mock-provider";
import type { PaymentProvider } from "./types";

let cached: { provider: PaymentProvider; name: string } | null = null;

/**
 * Resolve o provedor de pagamento ativo a partir do env.
 * O resultado é cacheado por nome de provedor (instâncias são stateless além da config).
 */
export function getPaymentProvider(env: Env): PaymentProvider {
  if (cached && cached.name === env.paymentsProvider) {
    return cached.provider;
  }
  const provider: PaymentProvider =
    env.paymentsProvider === "asaas" ? new AsaasPaymentProvider(env) : new MockPaymentProvider(env);
  cached = { provider, name: env.paymentsProvider };
  return provider;
}

export type {
  PaymentProvider,
  CreateChargeInput,
  CreateChargeResult,
  PixCheckout,
  WebhookInput,
  WebhookParseResult,
  WebhookEvent,
  PaymentDomainStatus
} from "./types";
