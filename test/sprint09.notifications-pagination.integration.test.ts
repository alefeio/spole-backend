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

describe("sprint 09 — notificações, paginação autenticada e gatilhos (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  let webhookSecret: string;

  beforeAll(async () => {
    const env = loadEnv();
    webhookSecret = env.paymentsWebhookSecret;
    const maybePool = createPostgresPool(env.postgres);
    const maybeRedis = createRedisClient(env.redis);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint09] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint09] Redis indisponível: pulando testes.");
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

  it("pagamento aprovado e webhook repetido geram uma notificação; listagens com meta", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s09_${suffix}@example.com`;
    const orgEmail = `org_s09_${suffix}@example.com`;
    const buyerEmail = `buy_s09_${suffix}@example.com`;
    const otherEmail = `oth_s09_${suffix}@example.com`;
    const catSlug = `cat-s09-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91710000001"
      })
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
      .send({ name: "Cat S09", slug: catSlug, icon: "ball" })
      .expect(201);
    const categoryId = (
      await request(app).get("/categories").expect(200)
    ).body.data.find((c: { slug: string }) => c.slug === catSlug).id as string;

    for (const [name, email, phone] of [
      ["Org", orgEmail, "91710000002"],
      ["Buyer", buyerEmail, "91710000003"],
      ["Other", otherEmail, "91710000004"]
    ] as const) {
      await request(app)
        .post("/auth/register")
        .send({ name, email, password: "SenhaSegura123", phone })
        .expect(201);
    }

    const orgToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: orgEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;
    const buyerToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: buyerEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;
    const otherToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: otherEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    const paidEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({
        categoryId,
        title: `Evento S09 ${suffix.slice(0, 6)}`,
        type: "PAID",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: "2028-10-10T18:00:00.000Z",
        endAt: "2028-10-10T20:00:00.000Z",
        addressName: "Quadra",
        street: "Rua A",
        number: "1",
        district: "Centro",
        city: "Belém",
        state: "PA",
        capacity: 5,
        pricePerPerson: 30
      })
      .expect(201);
    const eventId = paidEv.body.data.id as string;

    const bk = await request(app)
      .post(`/events/${eventId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({})
      .expect(201);
    const bookingId = bk.body.data.id as string;

    const pay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef = pay.body.data.providerReference as string;

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(200);

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(200);

    const notifs = await request(app)
      .get("/users/me/notifications")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({ limit: 50 })
      .expect(200);
    expect(notifs.body.meta).toMatchObject({ page: 1, limit: 50 });
    const paidNotifs = (notifs.body.data as { type: string }[]).filter((n) => n.type === "PAYMENT_CONFIRMED");
    expect(paidNotifs.length).toBe(1);

    const meBk = await request(app)
      .get("/users/me/bookings")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({ page: 1, limit: 10 })
      .expect(200);
    expect(meBk.body.meta.total).toBeGreaterThanOrEqual(1);
    expect((meBk.body.data as { id: string }[]).some((b) => b.id === bookingId)).toBe(true);

    const mePay = await request(app)
      .get("/users/me/payments")
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);
    expect(mePay.body.meta).toBeTruthy();
    expect((mePay.body.data as { bookingId: string }[]).some((p) => p.bookingId === bookingId)).toBe(true);

    const notifId = (notifs.body.data as { id: string }[])[0].id as string;
    const read = await request(app)
      .patch(`/notifications/${notifId}/read`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);
    expect(read.body.data.readAt).toBeTruthy();

    await request(app).patch(`/notifications/${notifId}/read`).set("Authorization", `Bearer ${otherToken}`).expect(403);

    const emails = [adminEmail, orgEmail, buyerEmail, otherEmail];
    await pool.query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
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
    await redis.del(bookingRedisKey(bookingId)).catch(() => undefined);
  });

  it("cancelamento de booking gera uma notificação; cancelamento repetido não duplica", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s09b_${suffix}@example.com`;
    const orgEmail = `org_s09b_${suffix}@example.com`;
    const buyerEmail = `buy_s09b_${suffix}@example.com`;
    const catSlug = `cat-s09b-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin B",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91720000001"
      })
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
      .send({ name: "Cat B", slug: catSlug, icon: "ball" })
      .expect(201);
    const categoryId = (
      await request(app).get("/categories").expect(200)
    ).body.data.find((c: { slug: string }) => c.slug === catSlug).id as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Org B", email: orgEmail, password: "SenhaSegura123", phone: "91720000002" })
      .expect(201);
    await request(app)
      .post("/auth/register")
      .send({ name: "Buyer B", email: buyerEmail, password: "SenhaSegura123", phone: "91720000003" })
      .expect(201);

    const orgToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: orgEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;
    const buyerToken = (
      await request(app)
        .post("/auth/login")
        .send({ email: buyerEmail, password: "SenhaSegura123" })
        .expect(200)
    ).body.data.token as string;

    const ev = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({
        categoryId,
        title: "Pago cancel",
        type: "PAID",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: "2028-11-10T18:00:00.000Z",
        endAt: "2028-11-10T20:00:00.000Z",
        addressName: "Q",
        street: "Rua",
        number: "1",
        district: "C",
        city: "Belém",
        state: "PA",
        capacity: 3,
        pricePerPerson: 20
      })
      .expect(201);
    const eventId = ev.body.data.id as string;

    const bk = await request(app)
      .post(`/events/${eventId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({})
      .expect(201);
    const bookingId = bk.body.data.id as string;

    await request(app).patch(`/bookings/${bookingId}/cancel`).set("Authorization", `Bearer ${buyerToken}`).expect(200);
    await request(app).patch(`/bookings/${bookingId}/cancel`).set("Authorization", `Bearer ${buyerToken}`).expect(200);

    const notifs = await request(app)
      .get("/users/me/notifications")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({ limit: 20 })
      .expect(200);
    const cancelled = (notifs.body.data as { type: string }[]).filter((n) => n.type === "BOOKING_CANCELLED");
    expect(cancelled.length).toBe(1);

    const emails = [adminEmail, orgEmail, buyerEmail];
    await pool.query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
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
  });
});
