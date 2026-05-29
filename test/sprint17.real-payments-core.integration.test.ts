import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  PAYMENT_WEBHOOK_SECRET_HEADER,
  RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER
} from "../src/modules/payments/routes";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { createRedisClient } from "../src/shared/cache/redis/redis";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

type App = ReturnType<typeof createApp>;

function paidEventPayload(categoryId: string, title: string, capacity: number, price = 30) {
  return {
    categoryId,
    title,
    type: "PAID" as const,
    visibility: "PUBLIC" as const,
    sourceType: "FREE_LOCATION" as const,
    status: "PUBLISHED" as const,
    startAt: "2030-05-10T18:00:00.000Z",
    endAt: "2030-05-10T20:00:00.000Z",
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

async function registerAndLogin(app: App, name: string, email: string, phone: string) {
  await request(app)
    .post("/auth/register")
    .send({ name, email, password: "SenhaSegura123", phone })
    .expect(201);
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password: "SenhaSegura123" })
    .expect(200);
  return login.body.data.token as string;
}

const checkoutMatcher = {
  pixCopyPaste: expect.any(String),
  pixQrCode: expect.any(String),
  paymentExpiresAt: expect.anything()
};

describe("sprint 17 — real payments core (integração, modo mock)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let app: App | undefined;
  let webhookSecret: string;

  beforeAll(async () => {
    process.env.BOOKING_TTL_SECONDS = "600";
    process.env.PAYMENTS_WEBHOOK_SECRET = "integration-webhook-secret";
    process.env.PAYMENTS_PROVIDER = "mock";
    const env = loadEnv();
    webhookSecret = env.paymentsWebhookSecret;
    const maybePool = createPostgresPool(env.postgres);
    const maybeRedis = createRedisClient(env.redis);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint17] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      return;
    }
    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint17] Redis indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      await maybeRedis.quit().catch(() => undefined);
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

  async function createPaidEventBooking(suffix: string, price = 30) {
    const adminEmail = `adm_s17_${suffix}@example.com`;
    const orgEmail = `org_s17_${suffix}@example.com`;
    const buyerEmail = `buy_s17_${suffix}@example.com`;
    const catSlug = `cat-s17-${suffix.slice(0, 8)}`;

    await request(app!)
      .post("/auth/register")
      .send({ name: "Admin", email: adminEmail, password: "SenhaSegura123", phone: "91560000001" })
      .expect(201);
    await pool!.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app!).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    await request(app!)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat S17", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(app!).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)
      ?.id as string;

    const orgToken = await registerAndLogin(app!, "Org", orgEmail, "91560000002");
    const buyerToken = await registerAndLogin(app!, "Buyer", buyerEmail, "91560000003");

    const ev = await request(app!)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, `Pago S17 ${suffix.slice(0, 6)}`, 5, price))
      .expect(201);
    const eventId = ev.body.data.id as string;

    const bk = await request(app!)
      .post(`/events/${eventId}/bookings`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({})
      .expect(201);
    const bookingId = bk.body.data.id as string;

    return { adminEmail, orgEmail, buyerEmail, catSlug, buyerToken, eventId, bookingId };
  }

  async function cleanupByEmails(emails: string[], catSlug?: string) {
    await pool!.query(`DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool!.query(
      `DELETE FROM event_participants WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool!.query(`DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool!.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool!.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    if (catSlug) await pool!.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);
  }

  it("booking: criação retorna checkout + contextExpiresAt; GET pendente expõe checkout; webhook PAID idempotente", async () => {
    if (!pool || !redis || !app) return;
    const suffix = crypto.randomUUID();
    const { adminEmail, orgEmail, buyerEmail, catSlug, buyerToken, bookingId } = await createPaidEventBooking(
      suffix,
      40
    );

    const pay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);

    expect(pay.body.data).toMatchObject({
      status: "PENDING",
      grossAmount: 40,
      provider: "mock-provider",
      checkout: checkoutMatcher
    });
    expect(pay.body.data.providerReference).toEqual(expect.any(String));
    expect(pay.body.data).toHaveProperty("contextExpiresAt");

    const paymentId = pay.body.data.id as string;
    const providerRef = pay.body.data.providerReference as string;

    const pending = await request(app)
      .get(`/payments/${paymentId}`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);
    expect(pending.body.data.status).toBe("PENDING");
    expect(pending.body.data.checkout).toMatchObject(checkoutMatcher);

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, "wrong-secret")
      .send({ providerReference: providerRef, status: "PAID" })
      .expect(403);

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

    const paid = await request(app)
      .get(`/payments/${paymentId}`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);
    expect(paid.body.data.status).toBe("PAID");
    expect(paid.body.data.checkout).toBeNull();

    await cleanupByEmails([adminEmail, orgEmail, buyerEmail], catSlug);
  }, 30_000);

  it("booking: webhook FAILED marca pagamento FAILED sem concluir compra", async () => {
    if (!pool || !redis || !app) return;
    const suffix = crypto.randomUUID();
    const { adminEmail, orgEmail, buyerEmail, catSlug, buyerToken, bookingId } = await createPaidEventBooking(suffix);

    const pay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef = pay.body.data.providerReference as string;

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "FAILED" })
      .expect(200);

    const payRow = await pool.query<{ status: string }>(
      `SELECT status::text FROM payments WHERE provider_reference = $1`,
      [providerRef]
    );
    expect(payRow.rows[0]?.status).toBe("FAILED");

    const bookingRow = await pool.query<{ status: string }>(`SELECT status::text FROM bookings WHERE id = $1`, [
      bookingId
    ]);
    expect(bookingRow.rows[0]?.status).toBe("RESERVED");

    await cleanupByEmails([adminEmail, orgEmail, buyerEmail], catSlug);
  }, 30_000);

  it("booking: webhook CANCELLED marca pagamento CANCELLED", async () => {
    if (!pool || !redis || !app) return;
    const suffix = crypto.randomUUID();
    const { adminEmail, orgEmail, buyerEmail, catSlug, buyerToken, bookingId } = await createPaidEventBooking(suffix);

    const pay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef = pay.body.data.providerReference as string;

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "CANCELLED" })
      .expect(200);

    const payRow = await pool.query<{ status: string }>(
      `SELECT status::text FROM payments WHERE provider_reference = $1`,
      [providerRef]
    );
    expect(payRow.rows[0]?.status).toBe("CANCELLED");

    // webhook repetido continua idempotente
    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "CANCELLED" })
      .expect(200);

    await cleanupByEmails([adminEmail, orgEmail, buyerEmail], catSlug);
  }, 30_000);

  it("booking: status desconhecido no webhook retorna 422", async () => {
    if (!pool || !redis || !app) return;
    const suffix = crypto.randomUUID();
    const { adminEmail, orgEmail, buyerEmail, catSlug, buyerToken, bookingId } = await createPaidEventBooking(suffix);

    const pay = await request(app)
      .post(`/bookings/${bookingId}/payments`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef = pay.body.data.providerReference as string;

    const wh = await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "REFUNDED" })
      .expect(422);
    expect(wh.body.error.code).toBe("UNSUPPORTED_WEBHOOK_STATUS");

    await cleanupByEmails([adminEmail, orgEmail, buyerEmail], catSlug);
  }, 30_000);

  async function setupArenaSlot(suffix: string, opts: { recurring: boolean }) {
    const ownerEmail = `own_s17_${suffix}@example.com`;
    const orgEmail = `orgr_s17_${suffix}@example.com`;
    await request(app!)
      .post("/auth/register")
      .send({ name: "Owner", email: ownerEmail, password: "SenhaSegura123", phone: "91570000001" })
      .expect(201);
    await pool!.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    const ownerToken2 = (
      await request(app!).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const orgToken = await registerAndLogin(app!, "OrgR", orgEmail, "91570000002");

    const arena = await request(app!)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken2}`)
      .send({
        name: "Arena S17",
        phone: "91999991700",
        email: `arena-s17-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000170",
        address: { zipCode: "66000-000", street: "Rua", number: "1", district: "C", city: "Belém", state: "PA" },
        policy: { allowRecurring: opts.recurring, minAdvanceHours: 0, minReservationPaymentPercent: 100 }
      })
      .expect(201);
    const arenaId = arena.body.data.id as string;
    const space = await request(app!)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken2}`)
      .send({ name: "Q", type: "court" })
      .expect(201);
    const spaceId = space.body.data.id as string;
    const slot = await request(app!)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken2}`)
      .send({
        startAt: "2031-03-01T10:00:00.000Z",
        endAt: "2031-03-01T11:00:00.000Z",
        price: 100,
        allowsRecurring: opts.recurring
      })
      .expect(201);
    const slotId = slot.body.data.id as string;
    return { ownerEmail, orgEmail, ownerToken: ownerToken2, orgToken, arenaId, spaceId, slotId };
  }

  async function cleanupArena(emails: string[], arenaId: string, spaceId: string) {
    await pool!.query(`DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool!.query(
      `DELETE FROM reservation_occurrences WHERE recurrence_id IN (
        SELECT rr.id FROM reservation_recurrences rr
        INNER JOIN reservations r ON r.id = rr.reservation_id
        WHERE r.organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))
      )`,
      [emails]
    );
    await pool!.query(
      `DELETE FROM reservation_recurrences WHERE reservation_id IN (
        SELECT id FROM reservations WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))
      )`,
      [emails]
    );
    await pool!.query(
      `DELETE FROM reservations WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool!.query(`DELETE FROM arena_slots WHERE space_id = $1`, [spaceId]);
    await pool!.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool!.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool!.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool!.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool!.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  }

  it("reservation: criação retorna checkout; webhook FAILED marca pagamento FAILED", async () => {
    if (!pool || !redis || !app) return;
    const suffix = crypto.randomUUID();
    const { ownerEmail, orgEmail, orgToken, arenaId, spaceId, slotId } = await setupArenaSlot(suffix, {
      recurring: false
    });

    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(201);
    const reservationId = resv.body.data.id as string;

    const pay = await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    expect(pay.body.data).toMatchObject({ status: "PENDING", checkout: checkoutMatcher });
    expect(pay.body.data).toHaveProperty("contextExpiresAt");
    const providerRef = pay.body.data.providerReference as string;

    await request(app)
      .post("/reservation-payments/webhook")
      .set(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef, status: "FAILED" })
      .expect(200);

    const payRow = await pool.query<{ status: string }>(
      `SELECT status::text FROM payments WHERE provider_reference = $1`,
      [providerRef]
    );
    expect(payRow.rows[0]?.status).toBe("FAILED");
    const resvRow = await pool.query<{ status: string }>(`SELECT status::text FROM reservations WHERE id = $1`, [
      reservationId
    ]);
    expect(resvRow.rows[0]?.status).toBe("PENDING");

    await cleanupArena([ownerEmail, orgEmail], arenaId, spaceId);
  }, 30_000);

  it("occurrence: criação de pagamento retorna checkout e confirma via webhook PAID", async () => {
    if (!pool || !redis || !app) return;
    const suffix = crypto.randomUUID();
    const { ownerEmail, orgEmail, orgToken, arenaId, spaceId, slotId } = await setupArenaSlot(suffix, {
      recurring: true
    });

    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "RECURRING" })
      .expect(201);
    const reservationId = resv.body.data.id as string;

    const firstPay = await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    await request(app)
      .post("/reservation-payments/webhook")
      .set(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: firstPay.body.data.providerReference, status: "PAID" })
      .expect(200);

    const detail = await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);
    const occurrenceId = detail.body.data.nextOccurrence.id as string;
    expect(occurrenceId).toEqual(expect.any(String));

    const occPay = await request(app)
      .post(`/reservation-occurrences/${occurrenceId}/payments`)
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    expect(occPay.body.data).toMatchObject({
      reservationOccurrenceId: occurrenceId,
      status: "PENDING",
      checkout: checkoutMatcher
    });
    const occRef = occPay.body.data.providerReference as string;

    await request(app)
      .post("/reservation-payments/webhook")
      .set(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: occRef, status: "PAID" })
      .expect(200);

    const occRow = await pool.query<{ status: string }>(
      `SELECT status::text FROM reservation_occurrences WHERE id = $1`,
      [occurrenceId]
    );
    expect(occRow.rows[0]?.status).toBe("CONFIRMED");

    await cleanupArena([ownerEmail, orgEmail], arenaId, spaceId);
  }, 30_000);
});
