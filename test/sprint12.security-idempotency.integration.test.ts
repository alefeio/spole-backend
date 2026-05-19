import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { REQUEST_ID_HEADER } from "../src/shared/middleware/request-id";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { createRedisClient } from "../src/shared/cache/redis/redis";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv, type Env } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";
import { resetHealth, setPostgresHealthy, setRedisHealthy } from "../src/shared/health/health";
import { createCountingRedisClient, createFailingRedisClient } from "./test-deps";

function withRelaxedRateLimits(env: Env) {
  return {
    ...env,
    rateLimitAuth: { windowSeconds: 60, maxRequests: 200 },
    rateLimitPublicRead: { windowSeconds: 60, maxRequests: 200 },
    rateLimitAuthenticated: { windowSeconds: 60, maxRequests: 200 }
  };
}

function paidEventPayload(categoryId: string, title: string, capacity: number) {
  const start = "2028-06-10T18:00:00.000Z";
  const end = "2028-06-10T20:00:00.000Z";
  return {
    categoryId,
    title,
    type: "PAID" as const,
    visibility: "PUBLIC" as const,
    sourceType: "FREE_LOCATION" as const,
    status: "PUBLISHED" as const,
    startAt: start,
    endAt: end,
    addressName: "Quadra",
    street: "Rua B",
    number: "2",
    district: "Centro",
    city: "Belém",
    state: "PA",
    capacity,
    pricePerPerson: 30
  };
}

describe("sprint 12 — request id, rate limiting e idempotência (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let baseEnv: ReturnType<typeof loadEnv> | undefined;

  beforeAll(async () => {
    process.env.BOOKING_TTL_SECONDS = "600";
    process.env.PAYMENTS_WEBHOOK_SECRET = "integration-webhook-secret";

    const env = loadEnv();
    baseEnv = env;
    const maybePool = createPostgresPool(env.postgres);
    const maybeRedis = createRedisClient(env.redis);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint12] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint12] Redis indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      await maybeRedis.quit().catch(() => undefined);
      pool = undefined;
      return;
    }

    pool = maybePool;
    redis = maybeRedis;
    await runMigrations(pool, logger);
  });

  afterAll(async () => {
    await redis?.quit().catch(() => undefined);
    await pool?.end();
  });

  it("propaga X-Request-Id na resposta (gerado ou reutilizado)", async () => {
    if (!pool || !baseEnv) return;
    setPostgresHealthy(true);
    setRedisHealthy(true);
    const app = createApp({ pool, env: baseEnv, redis: createCountingRedisClient() });

    const customId = "client-req-abc-123";
    const withClient = await request(app).get("/health").set(REQUEST_ID_HEADER, customId).expect(200);
    expect(withClient.headers[REQUEST_ID_HEADER]).toBe(customId);

    const generated = await request(app).get("/health").expect(200);
    const rid = generated.headers[REQUEST_ID_HEADER] as string;
    expect(rid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("rate limit em auth e GET /events retorna 429", async () => {
    if (!pool || !baseEnv) return;
    const strictEnv: Env = {
      ...baseEnv,
      rateLimitAuth: { windowSeconds: 60, maxRequests: 2 },
      rateLimitPublicRead: { windowSeconds: 60, maxRequests: 2 }
    };
    const app = createApp({ pool, env: strictEnv, redis: createCountingRedisClient() });
    const suffix = crypto.randomUUID();
    const email = `rl_s12_${suffix}@example.com`;

    const first = await request(app)
      .post("/auth/register")
      .send({ name: "RL", email, password: "SenhaSegura123", phone: "91800000001" });
    expect(first.status).toBeLessThan(500);

    const second = await request(app)
      .post("/auth/register")
      .send({ name: "RL2", email: `other_${suffix}@example.com`, password: "SenhaSegura123" });
    expect(second.status).toBeLessThan(500);

    const limited = await request(app)
      .post("/auth/register")
      .send({ name: "RL3", email: `third_${suffix}@example.com`, password: "SenhaSegura123" });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMIT_EXCEEDED");

    await request(app).get("/events").expect(200);
    await request(app).get("/events").expect(200);
    const eventsLimited = await request(app).get("/events");
    expect(eventsLimited.status).toBe(429);
    expect(eventsLimited.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("fail-open: indisponibilidade do Redis não bloqueia a requisição", async () => {
    if (!pool || !baseEnv) return;
    setPostgresHealthy(true);
    setRedisHealthy(true);
    const app = createApp({ pool, env: baseEnv, redis: createFailingRedisClient() });
    await request(app).get("/health").expect(200);
  });

  it("idempotência de booking: mesma chave não duplica reserva", async () => {
    if (!pool || !redis || !baseEnv) return;
    const app = createApp({ pool, env: withRelaxedRateLimits(baseEnv), redis });

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s12_${suffix}@example.com`;
    const orgEmail = `org_s12_${suffix}@example.com`;
    const buyerEmail = `buy_s12_${suffix}@example.com`;
    const catSlug = `cat-s12-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Admin", email: adminEmail, password: "SenhaSegura123", phone: "91910000001" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: adminEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat S12", slug: catSlug, icon: "ball" })
      .expect(201);
    const categoryId = (
      (await request(app).get("/categories").expect(200)).body.data as { id: string; slug: string }[]
    ).find((c) => c.slug === catSlug)!.id;

    await request(app)
      .post("/auth/register")
      .send({ name: "Org", email: orgEmail, password: "SenhaSegura123", phone: "91910000002" })
      .expect(201);
    const orgToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: orgEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Buyer", email: buyerEmail, password: "SenhaSegura123", phone: "91910000003" })
      .expect(201);
    const buyerToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: buyerEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    const event = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, `Evento S12 ${suffix.slice(0, 6)}`, 10))
      .expect(201);
    const eventId = event.body.data.id as string;

    const idemKey = `booking-${suffix}`;
    const first = await request(app)
      .post(`/events/${eventId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Idempotency-Key", idemKey)
      .expect(201);
    const bookingId = first.body.data.id as string;

    const replay = await request(app)
      .post(`/events/${eventId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Idempotency-Key", idemKey)
      .expect(201);
    expect(replay.body.data.id).toBe(bookingId);

    const count = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM bookings WHERE event_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
      [eventId, buyerEmail]
    );
    expect(Number(count.rows[0]?.c)).toBe(1);

    const conflict = await request(app)
      .post(`/events/${eventId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Idempotency-Key", idemKey)
      .query({ privateCode: "different-context" })
      .expect(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("idempotência de payment: mesma chave não duplica pagamento", async () => {
    if (!pool || !redis || !baseEnv) return;
    const app = createApp({ pool, env: withRelaxedRateLimits(baseEnv), redis });

    const suffix = crypto.randomUUID();
    const orgEmail = `org_pay_s12_${suffix}@example.com`;
    const buyerEmail = `buy_pay_s12_${suffix}@example.com`;
    const catSlug = `cat-pay-s12-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Org", email: orgEmail, password: "SenhaSegura123", phone: "91920000001" })
      .expect(201);
    const orgToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: orgEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Buyer", email: buyerEmail, password: "SenhaSegura123", phone: "91920000002" })
      .expect(201);
    const buyerToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: buyerEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    const adminEmail = `adm_pay_s12_${suffix}@example.com`;
    await request(app)
      .post("/auth/register")
      .send({ name: "Admin", email: adminEmail, password: "SenhaSegura123", phone: "91920000003" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: adminEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat Pay S12", slug: catSlug, icon: "ball" })
      .expect(201);
    const categoryId = (
      (await request(app).get("/categories").expect(200)).body.data as { id: string; slug: string }[]
    ).find((c) => c.slug === catSlug)!.id;

    const eventId = (
      await request(app)
        .post("/events")
        .set("Authorization", `Bearer ${orgToken}`)
        .send(paidEventPayload(categoryId, `Pay S12 ${suffix.slice(0, 6)}`, 5))
        .expect(201)
    ).body.data.id as string;

    const bookingId = (
      await request(app)
        .post(`/events/${eventId}/bookings`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(201)
    ).body.data.id as string;

    const payKey = `pay-${suffix}`;
    const first = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Idempotency-Key", payKey)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const paymentId = first.body.data.id as string;

    const replay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .set("Idempotency-Key", payKey)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    expect(replay.body.data.id).toBe(paymentId);

    const count = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM payments WHERE booking_id = $1`,
      [bookingId]
    );
    expect(Number(count.rows[0]?.c)).toBe(1);
  });
});
