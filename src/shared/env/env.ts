export type Env = {
  port: number;
  nodeEnv: string;
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    db: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  /** TTL da reserva temporária de booking (segundos). Default 1800 = 30 min. */
  bookingTtlSeconds: number;
  /** TTL do pagamento inicial da reserva de arena (segundos). Default 1800 = 30 min. */
  reservationTtlSeconds: number;
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    expiresIn: string;
  };
  /** Segredo enviado no header do webhook de pagamento (sem JWT). */
  paymentsWebhookSecret: string;
  /** TTL do cache de leitura pública (GET /events, GET /categories), em segundos. */
  publicReadCacheTtlSeconds: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function numberEnv(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (!raw) {
    if (fallback === undefined) throw new Error(`Missing required env var: ${name}`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number env var: ${name}`);
  }
  return n;
}

export function loadEnv(): Env {
  return {
    port: numberEnv("PORT", 3000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    postgres: {
      host: required("POSTGRES_HOST"),
      port: numberEnv("POSTGRES_PORT", 5432),
      user: required("POSTGRES_USER"),
      password: required("POSTGRES_PASSWORD"),
      db: required("POSTGRES_DB")
    },
    redis: {
      host: required("REDIS_HOST"),
      port: numberEnv("REDIS_PORT", 6379),
      password: process.env.REDIS_PASSWORD || undefined
    },
    bookingTtlSeconds: numberEnv("BOOKING_TTL_SECONDS", 1800),
    reservationTtlSeconds: numberEnv("RESERVATION_TTL_SECONDS", 1800),
    jwt: {
      secret: required("JWT_SECRET"),
      issuer: process.env.JWT_ISSUER ?? "spole-api",
      audience: process.env.JWT_AUDIENCE ?? "spole-clients",
      expiresIn: process.env.JWT_EXPIRES_IN ?? "7d"
    },
    paymentsWebhookSecret: required("PAYMENTS_WEBHOOK_SECRET"),
    publicReadCacheTtlSeconds: numberEnv("PUBLIC_READ_CACHE_TTL_SECONDS", 60)
  };
}
