import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { bookingRedisKey } from "../src/modules/bookings/booking-redis";
import { PAYMENT_WEBHOOK_SECRET_HEADER } from "../src/modules/payments/routes";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { createRedisClient } from "../src/shared/cache/redis/redis";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

function paidEventPayload(categoryId: string, title: string, capacity: number, price = 25) {
  const start = "2028-05-10T18:00:00.000Z";
  const end = "2028-05-10T20:00:00.000Z";
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
    pricePerPerson: price
  };
}

describe("sprint 07 — payments e confirmação de compra (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  let webhookSecret: string;

  beforeAll(async () => {
    process.env.BOOKING_TTL_SECONDS = "600";
    process.env.PAYMENTS_WEBHOOK_SECRET = "integration-webhook-secret";
    const env = loadEnv();
    webhookSecret = env.paymentsWebhookSecret;
    const maybePool = createPostgresPool(env.postgres);
    const maybeRedis = createRedisClient(env.redis);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint07] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint07] Redis indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      await maybeRedis.quit().catch(() => undefined);
      pool = undefined;
      return;
    }

    pool = maybePool;
    redis = maybeRedis;
    await runMigrations(pool, logger);
    app = createApp({ pool, env, redis });
  });

  afterAll(async () => {
    await redis?.quit().catch(() => undefined);
    await pool?.end();
  });

  it("fluxo pagamento: criar pendente, webhook PAID, participant, booking COMPLETED, redis limpo", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s07_${suffix}@example.com`;
    const orgEmail = `org_s07_${suffix}@example.com`;
    const buyerEmail = `buy_s07_${suffix}@example.com`;
    const otherEmail = `oth_s07_${suffix}@example.com`;
    const catSlug = `cat-s07-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91500000001"
      })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminLogin = await request(app)
      .post("/auth/login")
      .send({ email: adminEmail, password: "SenhaSegura123" })
      .expect(200);
    const adminToken = adminLogin.body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat S07", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)?.id as string;

    for (const [name, email, phone] of [
      ["Org", orgEmail, "91500000002"],
      ["Buyer", buyerEmail, "91500000003"],
      ["Other", otherEmail, "91500000004"]
    ] as const) {
      await request(app)
        .post("/auth/register")
        .send({ name, email, password: "SenhaSegura123", phone })
        .expect(201);
    }

    const orgLogin = await request(app)
      .post("/auth/login")
      .send({ email: orgEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgToken = orgLogin.body.data.token as string;
    const buyerLogin = await request(app)
      .post("/auth/login")
      .send({ email: buyerEmail, password: "SenhaSegura123" })
      .expect(200);
    const buyerToken = buyerLogin.body.data.token as string;
    const otherLogin = await request(app)
      .post("/auth/login")
      .send({ email: otherEmail, password: "SenhaSegura123" })
      .expect(200);
    const otherToken = otherLogin.body.data.token as string;

    const paidEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, "Pago S07", 5, 40))
      .expect(201);
    const paidId = paidEv.body.data.id as string;

    const bk = await request(app)
      .post(`/events/${paidId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({})
      .expect(201);
    const bookingId = bk.body.data.id as string;
    const rk = bookingRedisKey(bookingId);
    expect(await redis.get(rk)).toBe(bookingId);

    const pay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef = pay.body.data.providerReference as string;
    expect(pay.body.data).toMatchObject({
      status: "PENDING",
      grossAmount: 40,
      feeAmount: 0,
      netAmount: 40,
      provider: "mock-provider"
    });

    const dupPay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(409);
    expect(dupPay.body.error.code).toBe("PAYMENT_ALREADY_EXISTS");

    await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(403);

    const badSecret = await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, "wrong")
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(403);

    expect(badSecret.body.success).toBe(false);

    const w1 = await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(200);
    expect(w1.body.data).toEqual({ status: "processed" });

    const w2 = await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(200);
    expect(w2.body.data).toEqual({ status: "processed" });

    const meBk = await request(app).get("/users/me/bookings").set("Authorization", `Bearer ${buyerToken}`).expect(200);
    const rowBk = (meBk.body.data as { id: string; status: string }[]).find((b) => b.id === bookingId);
    expect(rowBk?.status).toBe("COMPLETED");

    expect(await redis.get(rk)).toBeNull();

    const meP = await request(app).get("/users/me/participants").set("Authorization", `Bearer ${buyerToken}`).expect(200);
    expect((meP.body.data as { eventId: string }[]).some((p) => p.eventId === paidId)).toBe(true);

    const mePay = await request(app).get("/users/me/payments").set("Authorization", `Bearer ${buyerToken}`).expect(200);
    const pRow = (mePay.body.data as { bookingId: string; status: string }[]).find((p) => p.bookingId === bookingId);
    expect(pRow?.status).toBe("PAID");

    const payId = pay.body.data.id as string;
    const onePay = await request(app).get(`/payments/${payId}`).set("Authorization", `Bearer ${buyerToken}`).expect(200);
    expect(onePay.body.data.status).toBe("PAID");
    expect(onePay.body.data.providerReference).toBe(providerRef);

    await request(app).get(`/payments/${payId}`).set("Authorization", `Bearer ${otherToken}`).expect(403);

    const rebook = await request(app)
      .post(`/events/${paidId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({})
      .expect(409);
    expect(rebook.body.error.code).toBe("ALREADY_REGISTERED");

    const emails = [adminEmail, orgEmail, buyerEmail, otherEmail];
    await pool.query(`DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM event_participants WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);
  },
  20_000);

  it("webhook não conclui compra com booking expirado", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s07b_${suffix}@example.com`;
    const orgEmail = `org_s07b_${suffix}@example.com`;
    const buyerEmail = `buy_s07b_${suffix}@example.com`;
    const catSlug = `cat-s07b-${suffix.slice(0, 8)}`;

    process.env.BOOKING_TTL_SECONDS = "1";
    const env = loadEnv();
    const appShort = createApp({ pool, env, redis });

    await request(appShort)
      .post("/auth/register")
      .send({
        name: "Admin B",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91400000001"
      })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminLogin = await request(appShort)
      .post("/auth/login")
      .send({ email: adminEmail, password: "SenhaSegura123" })
      .expect(200);
    const adminToken = adminLogin.body.data.token as string;

    await request(appShort)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat B", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(appShort).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)?.id as string;

    await request(appShort)
      .post("/auth/register")
      .send({ name: "Org B", email: orgEmail, password: "SenhaSegura123", phone: "91400000002" })
      .expect(201);
    await request(appShort)
      .post("/auth/register")
      .send({ name: "Buyer B", email: buyerEmail, password: "SenhaSegura123", phone: "91400000003" })
      .expect(201);

    const orgLogin = await request(appShort)
      .post("/auth/login")
      .send({ email: orgEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgToken = orgLogin.body.data.token as string;
    const buyerLogin = await request(appShort)
      .post("/auth/login")
      .send({ email: buyerEmail, password: "SenhaSegura123" })
      .expect(200);
    const buyerToken = buyerLogin.body.data.token as string;

    const paidEv = await request(appShort)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, "Pago expira", 3))
      .expect(201);
    const paidId = paidEv.body.data.id as string;

    const bk = await request(appShort)
      .post(`/events/${paidId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({})
      .expect(201);
    const bookingId = bk.body.data.id as string;

    const pay = await request(appShort)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef = pay.body.data.providerReference as string;

    await new Promise((r) => setTimeout(r, 2500));

    const wh = await request(appShort)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(422);
    expect(wh.body.error.code).toBe("PAYMENT_CANNOT_COMPLETE");

    const emails = [adminEmail, orgEmail, buyerEmail];
    await pool.query(`DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM event_participants WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);

    process.env.BOOKING_TTL_SECONDS = "600";
  },
  20_000);
});
