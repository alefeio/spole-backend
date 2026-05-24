import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { PAYMENT_WEBHOOK_SECRET_HEADER } from "../src/modules/payments/routes";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";
import { createStubRedisClient } from "./test-deps";

function paidEventPayload(categoryId: string, title: string, capacity: number, price = 30) {
  const start = "2029-06-10T18:00:00.000Z";
  const end = "2029-06-10T20:00:00.000Z";
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
    street: "Rua S16",
    number: "16",
    district: "Centro",
    city: "Belém",
    state: "PA",
    capacity,
    pricePerPerson: price
  };
}

function freeEventPayload(categoryId: string, title: string, capacity: number) {
  const start = "2029-07-10T18:00:00.000Z";
  const end = "2029-07-10T20:00:00.000Z";
  return {
    categoryId,
    title,
    type: "FREE" as const,
    visibility: "PUBLIC" as const,
    sourceType: "FREE_LOCATION" as const,
    status: "PUBLISHED" as const,
    startAt: start,
    endAt: end,
    addressName: "Campo",
    street: "Rua Free",
    number: "1",
    district: "Centro",
    city: "Belém",
    state: "PA",
    capacity
  };
}

describe("sprint 16 — organizer event operations read model (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  let webhookSecret: string;

  beforeAll(async () => {
    process.env.BOOKING_TTL_SECONDS = "600";
    process.env.PAYMENTS_WEBHOOK_SECRET = "s16-webhook-secret";
    const env = loadEnv();
    webhookSecret = env.paymentsWebhookSecret;
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint16.organizer-event-operations] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    pool = maybePool;
    await runMigrations(pool, logger);
    app = createApp({ pool, env, redis: createStubRedisClient() });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("GET /events/:eventId/bookings, /payments e /summary — operação do organizador", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s16_${suffix}@example.com`;
    const orgAEmail = `orga_s16_${suffix}@example.com`;
    const orgBEmail = `orgb_s16_${suffix}@example.com`;
    const buyer1Email = `buy1_s16_${suffix}@example.com`;
    const buyer2Email = `buy2_s16_${suffix}@example.com`;
    const freeUserEmail = `free_s16_${suffix}@example.com`;
    const catSlug = `cat-s16-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Admin S16", email: adminEmail, password: "SenhaSegura123", phone: "91600000001" })
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
      .send({ name: "Cat S16", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)?.id as string;

    for (const [name, email, phone] of [
      ["Org A", orgAEmail, "91600000002"],
      ["Org B", orgBEmail, "91600000003"],
      ["Buyer 1", buyer1Email, "91600000004"],
      ["Buyer 2", buyer2Email, "91600000005"],
      ["Free User", freeUserEmail, "91600000006"]
    ] as const) {
      await request(app)
        .post("/auth/register")
        .send({ name, email, password: "SenhaSegura123", phone })
        .expect(201);
    }

    const orgALogin = await request(app)
      .post("/auth/login")
      .send({ email: orgAEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgAToken = orgALogin.body.data.token as string;
    const orgBLogin = await request(app)
      .post("/auth/login")
      .send({ email: orgBEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgBToken = orgBLogin.body.data.token as string;
    const buyer1Login = await request(app)
      .post("/auth/login")
      .send({ email: buyer1Email, password: "SenhaSegura123" })
      .expect(200);
    const buyer1Token = buyer1Login.body.data.token as string;
    const buyer2Login = await request(app)
      .post("/auth/login")
      .send({ email: buyer2Email, password: "SenhaSegura123" })
      .expect(200);
    const buyer2Token = buyer2Login.body.data.token as string;
    const freeUserLogin = await request(app)
      .post("/auth/login")
      .send({ email: freeUserEmail, password: "SenhaSegura123" })
      .expect(200);
    const freeUserToken = freeUserLogin.body.data.token as string;

    const paidEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send(paidEventPayload(categoryId, "Evento Pago S16", 10, 50))
      .expect(201);
    const paidEventId = paidEv.body.data.id as string;

    const freeEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send(freeEventPayload(categoryId, "Evento Free S16", 20))
      .expect(201);
    const freeEventId = freeEv.body.data.id as string;

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgBToken}`)
      .send(paidEventPayload(categoryId, "Evento de B", 5, 20))
      .expect(201);

    await request(app).get(`/events/${paidEventId}/bookings`).expect(401);
    await request(app).get(`/events/${paidEventId}/payments`).expect(401);
    await request(app).get(`/events/${paidEventId}/summary`).expect(401);

    await request(app)
      .get(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(403);
    await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(403);
    await request(app)
      .get(`/events/${paidEventId}/summary`)
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(403);

    await request(app)
      .get(`/events/${crypto.randomUUID()}/summary`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .expect(404);

    const bk1 = await request(app)
      .post(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${buyer1Token}`)
      .send({})
      .expect(201);
    const booking1Id = bk1.body.data.id as string;

    const bk2 = await request(app)
      .post(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${buyer2Token}`)
      .send({})
      .expect(201);
    const booking2Id = bk2.body.data.id as string;

    const pay1 = await request(app)
      .post(`/bookings/${booking1Id}/payments`)
      .set("Authorization", `Bearer ${buyer1Token}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const providerRef1 = pay1.body.data.providerReference as string;

    const pay2 = await request(app)
      .post(`/bookings/${booking2Id}/payments`)
      .set("Authorization", `Bearer ${buyer2Token}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: providerRef1, status: "PAID" })
      .expect(200);

    await request(app)
      .post(`/events/${freeEventId}/participants/free`)
      .set("Authorization", `Bearer ${freeUserToken}`)
      .send({})
      .expect(201);

    const participants = await request(app)
      .get(`/events/${freeEventId}/participants`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .expect(200);
    expect(participants.body.data.length).toBeGreaterThanOrEqual(1);

    const bookingsOrg = await request(app)
      .get(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ limit: 50 })
      .expect(200);

    expect(bookingsOrg.body.success).toBe(true);
    expect(bookingsOrg.body.meta).toMatchObject({ page: 1, limit: 50, total: 2 });
    const bookingRows = bookingsOrg.body.data as Record<string, unknown>[];
    expect(bookingRows.some((b) => b.id === booking1Id && b.status === "COMPLETED")).toBe(true);
    expect(bookingRows.some((b) => b.id === booking2Id && b.status === "RESERVED")).toBe(true);
    for (const row of bookingRows) {
      expect(row).toHaveProperty("userId");
      expect(row).not.toHaveProperty("email");
      expect(row).not.toHaveProperty("name");
      expect(row).not.toHaveProperty("phone");
    }

    const bookingsCompleted = await request(app)
      .get(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ status: "COMPLETED" })
      .expect(200);
    expect(bookingsCompleted.body.meta.total).toBe(1);
    expect((bookingsCompleted.body.data as { id: string }[])[0]?.id).toBe(booking1Id);

    const bookingsPage = await request(app)
      .get(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ page: 1, limit: 1 })
      .expect(200);
    expect(bookingsPage.body.data).toHaveLength(1);
    expect(bookingsPage.body.meta.total).toBe(2);

    const bookingsAdmin = await request(app)
      .get(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(bookingsAdmin.body.meta.total).toBe(2);

    const paymentsOrg = await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ limit: 50 })
      .expect(200);

    expect(paymentsOrg.body.meta.total).toBe(2);
    const paymentRows = paymentsOrg.body.data as { id: string; bookingId: string; status: string; grossAmount: number }[];
    expect(paymentRows.some((p) => p.bookingId === booking1Id && p.status === "PAID")).toBe(true);
    expect(paymentRows.some((p) => p.bookingId === booking2Id && p.status === "PENDING")).toBe(true);

    const paymentsPaid = await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ status: "PAID" })
      .expect(200);
    expect(paymentsPaid.body.meta.total).toBe(1);
    expect((paymentsPaid.body.data as { bookingId: string }[])[0]?.bookingId).toBe(booking1Id);

    const paymentsPage = await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ page: 1, limit: 1 })
      .expect(200);
    expect(paymentsPage.body.data).toHaveLength(1);
    expect(paymentsPage.body.meta.total).toBe(2);

    await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(403);

    const paymentsAdmin = await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(paymentsAdmin.body.meta.total).toBe(2);

    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [orgAEmail]);
    const orgAOwnerLogin = await request(app)
      .post("/auth/login")
      .send({ email: orgAEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgAOwnerToken = orgAOwnerLogin.body.data.token as string;
    const orgEventToken = orgAOwnerToken;
    const arenaRes = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${orgAOwnerToken}`)
      .send({
        name: `Arena S16 ${suffix.slice(0, 6)}`,
        email: `arena-s16-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000181",
        phone: "91600000099",
        address: {
          street: "Rua Arena",
          number: "1",
          district: "Centro",
          city: "Belém",
          state: "PA",
          zipCode: "66000000"
        },
        policy: { allowRecurring: false, minAdvanceHours: 1, minReservationPaymentPercent: 100 }
      })
      .expect(201);
    const arenaId = arenaRes.body.data.id as string;
    const spaceRes = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${orgAOwnerToken}`)
      .send({ name: "Quadra S16", type: "court", capacitySuggestion: 10 })
      .expect(201);
    const spaceId = spaceRes.body.data.id as string;
    const slotRes = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${orgAOwnerToken}`)
      .send({
        startAt: "2029-08-01T10:00:00.000Z",
        endAt: "2029-08-01T11:00:00.000Z",
        price: 80,
        allowsRecurring: false
      })
      .expect(201);
    const slotId = slotRes.body.data.id as string;
    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgAOwnerToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(201);
    const reservationId = resv.body.data.id as string;
    await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${orgAOwnerToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);

    const paymentsAfterRes = await request(app)
      .get(`/events/${paidEventId}/payments`)
      .set("Authorization", `Bearer ${orgEventToken}`)
      .expect(200);
    expect(paymentsAfterRes.body.meta.total).toBe(2);
    for (const p of paymentsAfterRes.body.data as { bookingId: string; reservationId?: string }[]) {
      expect(p.bookingId).toBeTruthy();
      expect(p.reservationId).toBeUndefined();
    }

    const summaryPaid = await request(app)
      .get(`/events/${paidEventId}/summary`)
      .set("Authorization", `Bearer ${orgEventToken}`)
      .expect(200);

    expect(summaryPaid.body.data).toMatchObject({
      eventId: paidEventId,
      capacity: 10,
      confirmedParticipants: 1,
      activeBookings: 1,
      completedBookings: 1,
      paidPaymentsCount: 1,
      pendingPaymentsCount: 1,
      grossRevenue: 50,
      netRevenue: 50
    });
    expect(summaryPaid.body.data.remainingSpots).toBe(8);

    const summaryFree = await request(app)
      .get(`/events/${freeEventId}/summary`)
      .set("Authorization", `Bearer ${orgEventToken}`)
      .expect(200);
    expect(summaryFree.body.data).toMatchObject({
      eventId: freeEventId,
      capacity: 20,
      confirmedParticipants: 1,
      remainingSpots: 19
    });

    await request(app)
      .get(`/events/${paidEventId}/summary`)
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(403);

    await request(app)
      .get(`/events/${paidEventId}/summary`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const meBk = await request(app)
      .get("/users/me/bookings")
      .set("Authorization", `Bearer ${buyer1Token}`)
      .expect(200);
    expect(meBk.body.meta.total).toBeGreaterThanOrEqual(1);

    const buyer3Email = `buy3_s16_${suffix}@example.com`;
    await request(app)
      .post("/auth/register")
      .send({ name: "Buyer 3", email: buyer3Email, password: "SenhaSegura123", phone: "91600000007" })
      .expect(201);
    const buyer3Login = await request(app)
      .post("/auth/login")
      .send({ email: buyer3Email, password: "SenhaSegura123" })
      .expect(200);
    const buyer3Token = buyer3Login.body.data.token as string;

    await request(app)
      .post(`/events/${paidEventId}/bookings`)
      .set("Authorization", `Bearer ${buyer3Token}`)
      .send({})
      .expect(201);
  });
});
