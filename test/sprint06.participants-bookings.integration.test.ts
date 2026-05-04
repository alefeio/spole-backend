import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { bookingRedisKey } from "../src/modules/bookings/booking-redis";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { createRedisClient } from "../src/shared/cache/redis/redis";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

function freeEventPayload(categoryId: string, title: string, capacity: number) {
  const start = "2028-03-10T18:00:00.000Z";
  const end = "2028-03-10T20:00:00.000Z";
  return {
    categoryId,
    title,
    type: "FREE" as const,
    visibility: "PUBLIC" as const,
    sourceType: "FREE_LOCATION" as const,
    status: "PUBLISHED" as const,
    startAt: start,
    endAt: end,
    addressName: "Local",
    street: "Rua A",
    number: "1",
    district: "Centro",
    city: "Belém",
    state: "PA",
    capacity
  };
}

function paidEventPayload(categoryId: string, title: string, capacity: number) {
  const start = "2028-04-10T18:00:00.000Z";
  const end = "2028-04-10T20:00:00.000Z";
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
    pricePerPerson: 25
  };
}

describe("sprint 06 — participantes gratuitos e bookings pagos (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    process.env.BOOKING_TTL_SECONDS = "2";
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);
    const maybeRedis = createRedisClient(env.redis);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint06] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint06] Redis indisponível: pulando testes.");
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

  it(
    "inscrição gratuita, duplicata, lotação e listagens",
    async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s06_${suffix}@example.com`;
    const orgEmail = `org_s06_${suffix}@example.com`;
    const u1Email = `u1_s06_${suffix}@example.com`;
    const u2Email = `u2_s06_${suffix}@example.com`;
    const u3Email = `u3_s06_${suffix}@example.com`;
    const catSlug = `cat-s06-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91700000001"
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
      .send({ name: "Cat S06", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)?.id as string;

    for (const [name, email, phone] of [
      ["Org", orgEmail, "91700000002"],
      ["U1", u1Email, "91700000003"],
      ["U2", u2Email, "91700000004"],
      ["U3", u3Email, "91700000005"]
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

    const t1 = await request(app)
      .post("/auth/login")
      .send({ email: u1Email, password: "SenhaSegura123" })
      .expect(200);
    const t1Token = t1.body.data.token as string;
    const t2 = await request(app)
      .post("/auth/login")
      .send({ email: u2Email, password: "SenhaSegura123" })
      .expect(200);
    const t2Token = t2.body.data.token as string;
    const t3 = await request(app)
      .post("/auth/login")
      .send({ email: u3Email, password: "SenhaSegura123" })
      .expect(200);
    const t3Token = t3.body.data.token as string;

    const ev = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(freeEventPayload(categoryId, "Pelada free", 2))
      .expect(201);
    const eventId = ev.body.data.id as string;

    const j1 = await request(app)
      .post(`/events/${eventId}/participants/free`)
      .set("Authorization", `Bearer ${t1Token}`)
      .send({})
      .expect(201);
    expect(j1.body.data).toMatchObject({ status: "CONFIRMED", eventId });

    const dup = await request(app)
      .post(`/events/${eventId}/participants/free`)
      .set("Authorization", `Bearer ${t1Token}`)
      .send({})
      .expect(409);
    expect(dup.body.error.code).toBe("ALREADY_REGISTERED");

    await request(app)
      .post(`/events/${eventId}/participants/free`)
      .set("Authorization", `Bearer ${t2Token}`)
      .send({})
      .expect(201);

    const full = await request(app)
      .post(`/events/${eventId}/participants/free`)
      .set("Authorization", `Bearer ${t3Token}`)
      .send({})
      .expect(409);
    expect(full.body.error.code).toBe("EVENT_FULL");

    const listOrg = await request(app)
      .get(`/events/${eventId}/participants`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);
    expect((listOrg.body.data as unknown[]).length).toBe(2);

    const listDenied = await request(app)
      .get(`/events/${eventId}/participants`)
      .set("Authorization", `Bearer ${t1Token}`)
      .expect(403);
    expect(listDenied.body.success).toBe(false);

    const meP = await request(app).get("/users/me/participants").set("Authorization", `Bearer ${t1Token}`).expect(200);
    expect((meP.body.data as { eventId: string }[]).some((p) => p.eventId === eventId)).toBe(true);

    const meBk = await request(app).get("/users/me/bookings").set("Authorization", `Bearer ${t1Token}`).expect(200);
    expect(Array.isArray(meBk.body.data)).toBe(true);

    const paidEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, "Evento pago free join off", 5))
      .expect(201);
    const paidId = paidEv.body.data.id as string;

    const wrongType = await request(app)
      .post(`/events/${paidId}/participants/free`)
      .set("Authorization", `Bearer ${t3Token}`)
      .send({})
      .expect(422);
    expect(wrongType.body.error.code).toBe("EVENT_NOT_FREE");

    const emails = [adminEmail, orgEmail, u1Email, u2Email, u3Email];
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);
    },
    15_000
  );

  it(
    "booking pago, redis, cancelamento, concorrência na última vaga e expiração lazy",
    async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s06b_${suffix}@example.com`;
    const orgEmail = `org_s06b_${suffix}@example.com`;
    const aEmail = `a_s06b_${suffix}@example.com`;
    const bEmail = `b_s06b_${suffix}@example.com`;
    const catSlug = `cat-s06b-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin B",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91600000001"
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
      .send({ name: "Cat B", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)?.id as string;

    for (const [name, email, phone] of [
      ["Org B", orgEmail, "91600000002"],
      ["A", aEmail, "91600000003"],
      ["B", bEmail, "91600000004"]
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
    const aLogin = await request(app)
      .post("/auth/login")
      .send({ email: aEmail, password: "SenhaSegura123" })
      .expect(200);
    const aToken = aLogin.body.data.token as string;
    const bLogin = await request(app)
      .post("/auth/login")
      .send({ email: bEmail, password: "SenhaSegura123" })
      .expect(200);
    const bToken = bLogin.body.data.token as string;

    const ev1 = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, "Pago cap 1", 1))
      .expect(201);
    const eventOne = ev1.body.data.id as string;

    const bk = await request(app)
      .post(`/events/${eventOne}/bookings`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({})
      .expect(201);
    const bookingId = bk.body.data.id as string;
    expect(bk.body.data.status).toBe("RESERVED");
    expect(bk.body.data.expiresAt).toBeTruthy();

    const rk = bookingRedisKey(bookingId);
    const inRedis = await redis.get(rk);
    expect(inRedis).toBe(bookingId);

    const full = await request(app)
      .post(`/events/${eventOne}/bookings`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({})
      .expect(409);
    expect(full.body.error.code).toBe("EVENT_FULL");

    const dupBk = await request(app)
      .post(`/events/${eventOne}/bookings`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({})
      .expect(409);
    expect(dupBk.body.error.code).toBe("BOOKING_CONFLICT");

    const [c1, c2] = await Promise.all([
      request(app).post(`/events/${eventOne}/bookings`).set("Authorization", `Bearer ${aToken}`).send({}),
      request(app).post(`/events/${eventOne}/bookings`).set("Authorization", `Bearer ${bToken}`).send({})
    ]);
    const st = [c1.status, c2.status].sort((x, y) => x - y);
    expect(st).toEqual([409, 409]);

    await request(app)
      .patch(`/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${aToken}`)
      .expect(200);

    await redis.get(rk).then((v) => expect(v).toBeNull());

    const bkB = await request(app)
      .post(`/events/${eventOne}/bookings`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({})
      .expect(201);
    expect(bkB.body.data.status).toBe("RESERVED");

    await request(app).patch(`/bookings/${bkB.body.data.id}/cancel`).set("Authorization", `Bearer ${bToken}`).expect(200);

    const evConc = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, "Pago conc", 1))
      .expect(201);
    const eventConc = evConc.body.data.id as string;

    const [r1, r2] = await Promise.all([
      request(app).post(`/events/${eventConc}/bookings`).set("Authorization", `Bearer ${aToken}`).send({}),
      request(app).post(`/events/${eventConc}/bookings`).set("Authorization", `Bearer ${bToken}`).send({})
    ]);
    expect([r1.status, r2.status].sort((x, y) => x - y)).toEqual([201, 409]);

    const evLazy = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(paidEventPayload(categoryId, "Pago lazy", 2))
      .expect(201);
    const eventLazy = evLazy.body.data.id as string;

    const lazyBk = await request(app)
      .post(`/events/${eventLazy}/bookings`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({})
      .expect(201);
    const lazyId = lazyBk.body.data.id as string;

    await new Promise((r) => setTimeout(r, 2500));

    const meBefore = await request(app).get("/users/me/bookings").set("Authorization", `Bearer ${aToken}`).expect(200);
    const lazyRow = (meBefore.body.data as { id: string; status: string }[]).find((x) => x.id === lazyId);
    expect(lazyRow?.status).toBe("EXPIRED");

    await request(app).post(`/events/${eventLazy}/bookings`).set("Authorization", `Bearer ${aToken}`).send({}).expect(201);

    const evOnlyFree = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send(freeEventPayload(categoryId, "Só gratuito", 10))
      .expect(201);
    const onlyFreeId = evOnlyFree.body.data.id as string;

    const bookingOnFree = await request(app)
      .post(`/events/${onlyFreeId}/bookings`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({})
      .expect(422);
    expect(bookingOnFree.body.error.code).toBe("EVENT_NOT_PAID");

    const emails = [adminEmail, orgEmail, aEmail, bEmail];
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);
    },
    25_000
  );
});
