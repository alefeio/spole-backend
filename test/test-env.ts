import "dotenv/config";

// Defaults for local test runs (never override explicit env vars)
process.env.JWT_SECRET ??= "test-secret";
process.env.JWT_ISSUER ??= "spole-api";
process.env.JWT_AUDIENCE ??= "spole-clients";
process.env.JWT_EXPIRES_IN ??= "7d";
