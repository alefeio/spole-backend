export type PaymentDomainStatus = "PAID" | "FAILED" | "CANCELLED";

export type PixCheckout = {
  pixCopyPaste: string | null;
  pixQrCode: string | null;
  paymentExpiresAt: string | null;
};

export type CreateChargeInput = {
  /** Valor bruto da cobrança (na moeda do domínio). */
  amount: number;
  /** Descrição amigável exibida no provedor. */
  description: string;
  /** Referência externa (id do contexto de domínio: booking/reservation/occurrence). */
  externalReference: string;
  /** Prazo do contexto de domínio (booking.expiresAt / reservation.expiresAt / occurrence.dueAt). */
  contextExpiresAt: Date | null;
  /** Nome do pagador, quando disponível. */
  payerName?: string;
};

export type CreateChargeResult = {
  /** Identificador da cobrança no provedor (no modo real, o id do gateway). */
  providerReference: string;
  checkout: PixCheckout;
};

export type WebhookInput = {
  getHeader: (name: string) => string | undefined;
  /** Valor do header de segredo legado (X-Spole-*-Webhook-Secret), quando aplicável. */
  legacySecretValue: string | undefined;
  body: unknown;
};

export type WebhookParseResult =
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "unsupported_status" }
  | { kind: "ignore" }
  | {
      kind: "apply";
      providerReference: string;
      status: PaymentDomainStatus;
      /** Valor confirmado pelo provedor, quando disponível (para validação de valor). */
      paidAmount?: number;
    };

/** Evento de pagamento já normalizado, pronto para ser aplicado ao domínio. */
export type WebhookEvent = {
  providerReference: string;
  status: PaymentDomainStatus;
  /** Valor confirmado pelo provedor; quando presente, é validado contra o valor interno. */
  paidAmount?: number;
};

export interface PaymentProvider {
  readonly name: "mock" | "asaas";
  createPixCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  verifyAndParseWebhook(input: WebhookInput): WebhookParseResult;
}
