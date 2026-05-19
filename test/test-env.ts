import "dotenv/config";

// Defaults for local test runs (never override explicit env vars)
process.env.JWT_SECRET ??= "test-secret";
process.env.JWT_ISSUER ??= "spole-api";
process.env.JWT_AUDIENCE ??= "spole-clients";
process.env.JWT_EXPIRES_IN ??= "7d";
process.env.PAYMENTS_WEBHOOK_SECRET ??= "test-webhook-secret";
process.env.RATE_LIMIT_AUTH_MAX_REQUESTS ??= "10000";
process.env.RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS ??= "10000";
process.env.RATE_LIMIT_AUTHENTICATED_MAX_REQUESTS ??= "10000";
process.env.RATE_LIMIT_WEBHOOK_MAX_REQUESTS ??= "10000";
