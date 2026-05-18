import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createStubRedisClient } from "./test-deps";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

describe("sprint 11 — admin, moderação e auditoria (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint11] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      return;
    }

    pool = maybePool;
    await runMigrations(pool, logger);
    app = createApp({ pool, env, redis: createStubRedisClient() });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("não-admin recebe 403; admin lista usuários, altera status e gera auditoria", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s11_${suffix}@example.com`;
    const userEmail = `usr_s11_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Admin", email: adminEmail, password: "SenhaSegura123", phone: "91810000001" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);

    await request(app)
      .post("/auth/register")
      .send({ name: "User", email: userEmail, password: "SenhaSegura123", phone: "91810000002" })
      .expect(201);

    const adminToken = (
      await request(app).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const userToken = (
      await request(app).post("/auth/login").send({ email: userEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    const userId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [userEmail])
    ).rows[0].id;

    await request(app).get("/admin/users").set("Authorization", `Bearer ${userToken}`).expect(403);

    const list = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ limit: 50 })
      .expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(2);
    expect((list.body.data as { email: string }[]).some((u) => u.email === userEmail)).toBe(true);

    const detail = await request(app)
      .get(`/admin/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.data.email).toBe(userEmail);
    expect(detail.body.data.passwordHash).toBeUndefined();

    await request(app)
      .patch(`/admin/users/${userId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SUSPENDED", reason: "teste moderacao" })
      .expect(200);

    await request(app)
      .post("/auth/login")
      .send({ email: userEmail, password: "SenhaSegura123" })
      .expect(403);

    const audit = await request(app)
      .get("/admin/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ action: "USER_STATUS_CHANGED", limit: 20 })
      .expect(200);
    expect(
      (audit.body.data as { resourceId: string; action: string }[]).some(
        (l) => l.resourceId === userId && l.action === "USER_STATUS_CHANGED"
      )
    ).toBe(true);

    const selfPatch = await request(app)
      .patch(`/admin/users/${(await pool.query(`SELECT id FROM users WHERE email = $1`, [adminEmail])).rows[0].id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SUSPENDED", reason: "auto" })
      .expect(422);
    expect(selfPatch.body.error.code).toBe("ADMIN_CANNOT_MODIFY_SELF");

    await pool.query(`DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      [adminEmail, userEmail]
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[adminEmail, userEmail]]);
  });

  it("admin altera status de arena e cancela evento com auditoria", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s11b_${suffix}@example.com`;
    const ownerEmail = `own_s11b_${suffix}@example.com`;
    const orgEmail = `org_s11b_${suffix}@example.com`;
    const catSlug = `cat-s11b-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Admin", email: adminEmail, password: "SenhaSegura123", phone: "91820000001" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    await request(app)
      .post("/auth/register")
      .send({ name: "Owner", email: ownerEmail, password: "SenhaSegura123", phone: "91820000002" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    await request(app)
      .post("/auth/register")
      .send({ name: "Org", email: orgEmail, password: "SenhaSegura123", phone: "91820000003" })
      .expect(201);

    const adminToken = (
      await request(app).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const ownerToken = (
      await request(app).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;
    const orgToken = (
      await request(app).post("/auth/login").send({ email: orgEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat", slug: catSlug, icon: "ball" })
      .expect(201);
    const categoryId = (
      await request(app).get("/categories").expect(200)
    ).body.data.find((c: { slug: string }) => c.slug === catSlug).id as string;

    const arena = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Arena S11",
        phone: "91999990000",
        email: `arena-s11-${suffix.slice(0, 8)}@example.com`,
        document: "11222333000188",
        address: {
          zipCode: "66000-000",
          street: "Rua",
          number: "1",
          district: "C",
          city: "Belém",
          state: "PA"
        },
        policy: { allowRecurring: false, minAdvanceHours: 0, minReservationPaymentPercent: 0 }
      })
      .expect(201);
    const arenaId = arena.body.data.id as string;

    await request(app)
      .patch(`/admin/arenas/${arenaId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE", reason: "moderacao arena" })
      .expect(200);

    const arenasList = await request(app)
      .get("/admin/arenas")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ status: "INACTIVE", limit: 50 })
      .expect(200);
    expect((arenasList.body.data as { id: string }[]).some((a) => a.id === arenaId)).toBe(true);

    const ev = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({
        categoryId,
        title: "Evento mod",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: "2030-01-10T18:00:00.000Z",
        endAt: "2030-01-10T20:00:00.000Z",
        addressName: "L",
        street: "Rua",
        number: "1",
        district: "C",
        city: "Belém",
        state: "PA",
        capacity: 10
      })
      .expect(201);
    const eventId = ev.body.data.id as string;

    await request(app)
      .patch(`/admin/events/${eventId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED", reason: "moderacao evento" })
      .expect(200);

    const evRow = await pool.query<{ status: string }>(`SELECT status::text FROM events WHERE id = $1`, [eventId]);
    expect(evRow.rows[0]?.status).toBe("CANCELLED");

    const auditArena = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM audit_logs WHERE resource_type = 'ARENA' AND resource_id = $1`,
      [arenaId]
    );
    expect(Number(auditArena.rows[0]?.c)).toBeGreaterThanOrEqual(1);

    const emails = [adminEmail, ownerEmail, orgEmail];
    await pool.query(`DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);
  });

  it("admin lista reservations, bookings e payments", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s11c_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Admin", email: adminEmail, password: "SenhaSegura123", phone: "91830000001" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" }).expect(200)
    ).body.data.token as string;

    const resv = await request(app)
      .get("/admin/reservations")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ page: 1, limit: 5 })
      .expect(200);
    expect(resv.body.meta).toMatchObject({ page: 1, limit: 5 });

    const bk = await request(app)
      .get("/admin/bookings")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(bk.body.data)).toBe(true);

    const pay = await request(app)
      .get("/admin/payments")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(pay.body.data)).toBe(true);

    await pool.query(`DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email = $1)`, [
      adminEmail
    ]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [adminEmail]);
  });
});
