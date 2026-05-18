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

async function confirmReservationPayment(
  app: ReturnType<typeof createApp>,
  token: string,
  reservationId: string,
  webhookSecret: string
) {
  const pay = await request(app)
    .post(`/reservations/${reservationId}/payments`)
    .set("Authorization", `Bearer ${token}`)
    .send({ method: "PIX", provider: "mock-provider" })
    .expect(201);
  const ref = pay.body.data.providerReference as string;
  await request(app)
    .post("/reservation-payments/webhook")
    .set(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
    .send({ providerReference: ref, status: "PAID" })
    .expect(200);
  return pay.body.data.id as string;
}

describe("sprint 10 — pagamento de reserva e recorrência (integração)", () => {
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
      console.warn("[sprint10] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      return;
    }

    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint10] Redis indisponível: pulando testes.");
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

  it("reserva PENDING, pagamento e webhook confirmam; webhook repetido é idempotente", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const ownerEmail = `own_s10_${suffix}@example.com`;
    const orgEmail = `org_s10_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Owner", email: ownerEmail, password: "SenhaSegura123", phone: "91730000001" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    await request(app)
      .post("/auth/register")
      .send({ name: "Org", email: orgEmail, password: "SenhaSegura123", phone: "91730000002" })
      .expect(201);

    const ownerToken = (
      await request(app).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const orgToken = (
      await request(app).post("/auth/login").send({ email: orgEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    const arena = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Arena S10",
        phone: "91999990000",
        email: `arena-s10-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000199",
        address: {
          zipCode: "66000-000",
          street: "Rua",
          number: "1",
          district: "C",
          city: "Belém",
          state: "PA"
        },
        policy: { allowRecurring: false, minAdvanceHours: 0, minReservationPaymentPercent: 100 }
      })
      .expect(201);
    const arenaId = arena.body.data.id as string;

    const space = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Q", type: "court" })
      .expect(201);
    const spaceId = space.body.data.id as string;

    const slot = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: "2029-03-01T10:00:00.000Z",
        endAt: "2029-03-01T11:00:00.000Z",
        price: 100,
        allowsRecurring: false
      })
      .expect(201);
    const slotId = slot.body.data.id as string;

    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(201);
    expect(resv.body.data.status).toBe("PENDING");
    const reservationId = resv.body.data.id as string;

    const slotHold = await pool.query<{ status: string }>(`SELECT status::text FROM arena_slots WHERE id = $1`, [
      slotId
    ]);
    expect(slotHold.rows[0]?.status).toBe("HOLD");

    const pay = await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ method: "PIX", provider: "mock-provider" })
      .expect(201);
    const ref = pay.body.data.providerReference as string;

    await request(app)
      .post("/reservation-payments/webhook")
      .set(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: ref, status: "PAID" })
      .expect(200);
    await request(app)
      .post("/reservation-payments/webhook")
      .set(RESERVATION_PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: ref, status: "PAID" })
      .expect(200);

    const detail = await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);
    expect(detail.body.data.status).toBe("CONFIRMED");
    expect(detail.body.data.financial.paidAmount).toBe(100);

    const payCount = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM payments WHERE reservation_id = $1 AND status = 'PAID'`,
      [reservationId]
    );
    expect(Number(payCount.rows[0]?.c)).toBe(1);

    await pool.query(`DELETE FROM payments WHERE reservation_id = $1`, [reservationId]);
    await pool.query(`DELETE FROM reservations WHERE id = $1`, [reservationId]);
    await pool.query(`DELETE FROM arena_slots WHERE space_id = $1`, [spaceId]);
    await pool.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[ownerEmail, orgEmail]]);
  });

  it("min_reservation_payment_percent 0 confirma sem Payment", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const ownerEmail = `own_s10z_${suffix}@example.com`;
    const orgEmail = `org_s10z_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "O", email: ownerEmail, password: "SenhaSegura123", phone: "91730000010" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    await request(app)
      .post("/auth/register")
      .send({ name: "G", email: orgEmail, password: "SenhaSegura123", phone: "91730000011" })
      .expect(201);

    const ownerToken = (
      await request(app).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const orgToken = (
      await request(app).post("/auth/login").send({ email: orgEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    const arena = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Arena Zero",
        phone: "91999990001",
        email: `arena-z-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000198",
        address: {
          zipCode: "66000-000",
          street: "Rua",
          number: "2",
          district: "C",
          city: "Belém",
          state: "PA"
        },
        policy: { allowRecurring: false, minAdvanceHours: 0, minReservationPaymentPercent: 0 }
      })
      .expect(201);
    const arenaId = arena.body.data.id as string;
    const space = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Q", type: "court" })
      .expect(201);
    const spaceId = space.body.data.id as string;
    const slot = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: "2029-04-01T10:00:00.000Z",
        endAt: "2029-04-01T11:00:00.000Z",
        price: 50,
        allowsRecurring: false
      })
      .expect(201);
    const slotId = slot.body.data.id as string;

    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(201);
    expect(resv.body.data.status).toBe("CONFIRMED");

    const pays = await pool.query(`SELECT 1 FROM payments WHERE reservation_id = $1`, [resv.body.data.id]);
    expect(pays.rowCount).toBe(0);

    await pool.query(`DELETE FROM reservations WHERE id = $1`, [resv.body.data.id]);
    await pool.query(`DELETE FROM arena_slots WHERE space_id = $1`, [spaceId]);
    await pool.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[ownerEmail, orgEmail]]);
  });

  it("recorrência semanal gera próxima ocorrência; inadimplência libera slot", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const ownerEmail = `own_s10r_${suffix}@example.com`;
    const orgEmail = `org_s10r_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Owner R", email: ownerEmail, password: "SenhaSegura123", phone: "91730000020" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    await request(app)
      .post("/auth/register")
      .send({ name: "Org R", email: orgEmail, password: "SenhaSegura123", phone: "91730000021" })
      .expect(201);

    const ownerToken = (
      await request(app).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const orgToken = (
      await request(app).post("/auth/login").send({ email: orgEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    const arena = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Arena Rec",
        phone: "91999990002",
        email: `arena-r-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000197",
        address: {
          zipCode: "66000-000",
          street: "Rua",
          number: "3",
          district: "C",
          city: "Belém",
          state: "PA"
        },
        policy: { allowRecurring: true, minAdvanceHours: 0, minReservationPaymentPercent: 100 }
      })
      .expect(201);
    const arenaId = arena.body.data.id as string;
    const space = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Q", type: "court" })
      .expect(201);
    const spaceId = space.body.data.id as string;
    const slot = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: "2029-05-01T10:00:00.000Z",
        endAt: "2029-05-01T11:00:00.000Z",
        price: 80,
        allowsRecurring: true
      })
      .expect(201);
    const slotId = slot.body.data.id as string;

    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "RECURRING" })
      .expect(201);
    const reservationId = resv.body.data.id as string;
    await confirmReservationPayment(app, orgToken, reservationId, webhookSecret);

    const detail = await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);
    expect(detail.body.data.recurrence).toBeTruthy();
    expect(detail.body.data.nextOccurrence).toBeTruthy();
    const occurrenceId = detail.body.data.nextOccurrence.id as string;
    const futureSlotId = (
      await pool.query<{ slot_id: string }>(`SELECT slot_id FROM reservation_occurrences WHERE id = $1`, [
        occurrenceId
      ])
    ).rows[0]?.slot_id;
    expect(futureSlotId).toBeTruthy();

    await pool.query(
      `UPDATE reservation_occurrences SET due_at = now() - interval '1 minute' WHERE id = $1`,
      [occurrenceId]
    );

    await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);

    const occSt = await pool.query<{ status: string }>(
      `SELECT status::text FROM reservation_occurrences WHERE id = $1`,
      [occurrenceId]
    );
    expect(occSt.rows[0]?.status).toBe("RELEASED");

    const slotSt = await pool.query<{ status: string }>(`SELECT status::text FROM arena_slots WHERE id = $1`, [
      futureSlotId
    ]);
    expect(slotSt.rows[0]?.status).toBe("AVAILABLE");

    await pool.query(`DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      [ownerEmail, orgEmail]
    ]);
    await pool.query(`DELETE FROM reservation_occurrences WHERE recurrence_id IN (
      SELECT id FROM reservation_recurrences WHERE reservation_id = $1
    )`, [reservationId]);
    await pool.query(`DELETE FROM reservation_recurrences WHERE reservation_id = $1`, [reservationId]);
    await pool.query(`DELETE FROM reservations WHERE id = $1`, [reservationId]);
    await pool.query(`DELETE FROM arena_slots WHERE space_id = $1`, [spaceId]);
    await pool.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[ownerEmail, orgEmail]]);
  });

  it("webhook de booking não processa pagamento de reserva", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const ownerEmail = `own_s10b_${suffix}@example.com`;
    const orgEmail = `org_s10b_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "O", email: ownerEmail, password: "SenhaSegura123", phone: "91730000030" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    await request(app)
      .post("/auth/register")
      .send({ name: "G", email: orgEmail, password: "SenhaSegura123", phone: "91730000031" })
      .expect(201);

    const ownerToken = (
      await request(app).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const orgToken = (
      await request(app).post("/auth/login").send({ email: orgEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    const arena = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Arena B",
        phone: "91999990003",
        email: `arena-b-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000196",
        address: {
          zipCode: "66000-000",
          street: "Rua",
          number: "4",
          district: "C",
          city: "Belém",
          state: "PA"
        },
        policy: { allowRecurring: false, minAdvanceHours: 0, minReservationPaymentPercent: 100 }
      })
      .expect(201);
    const arenaId = arena.body.data.id as string;
    const space = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Q", type: "court" })
      .expect(201);
    const spaceId = space.body.data.id as string;
    const slot = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: "2029-06-01T10:00:00.000Z",
        endAt: "2029-06-01T11:00:00.000Z",
        price: 40,
        allowsRecurring: false
      })
      .expect(201);
    const slotId = slot.body.data.id as string;

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
    const ref = pay.body.data.providerReference as string;

    await request(app)
      .post("/payments/webhook")
      .set(PAYMENT_WEBHOOK_SECRET_HEADER, webhookSecret)
      .send({ providerReference: ref, status: "PAID" })
      .expect(404);

    const st = await pool.query<{ status: string }>(`SELECT status::text FROM reservations WHERE id = $1`, [
      reservationId
    ]);
    expect(st.rows[0]?.status).toBe("PENDING");

    await pool.query(`DELETE FROM payments WHERE reservation_id = $1`, [reservationId]);
    await pool.query(`DELETE FROM reservations WHERE id = $1`, [reservationId]);
    await pool.query(`DELETE FROM arena_slots WHERE space_id = $1`, [spaceId]);
    await pool.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[ownerEmail, orgEmail]]);
  });
});
