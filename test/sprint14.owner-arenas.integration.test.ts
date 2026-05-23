import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createStubRedisClient } from "./test-deps";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

const arenaPayload = (name: string, city: string, state: string) => ({
  name,
  description: "Arena do dono",
  phone: "91988887777",
  email: `${name.replace(/\s/g, "").toLowerCase()}@arena.example.com`,
  document: "12345678000199",
  address: {
    zipCode: "66000-000",
    street: "Av. Teste",
    number: "100",
    district: "Centro",
    city,
    state
  },
  policy: {
    allowRecurring: true,
    minAdvanceHours: 2,
    minReservationPaymentPercent: 30
  }
});

describe("sprint 14 — owner arenas read model (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint14.owner-arenas] Postgres indisponível: pulando testes.");
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

  it("GET /users/me/arenas — listagem do dono, filtros e isolamento", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const ownerAEmail = `owner_a_${suffix}@example.com`;
    const ownerBEmail = `owner_b_${suffix}@example.com`;
    const userEmail = `user_only_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "User Comum", email: userEmail, password: "SenhaSegura123", phone: "91999999001" })
      .expect(201);
    const userLogin = await request(app)
      .post("/auth/login")
      .send({ email: userEmail, password: "SenhaSegura123" })
      .expect(200);
    const userToken = userLogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Dono A", email: ownerAEmail, password: "SenhaSegura123", phone: "91999999002" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerAEmail]);
    const ownerALogin = await request(app)
      .post("/auth/login")
      .send({ email: ownerAEmail, password: "SenhaSegura123" })
      .expect(200);
    const ownerAToken = ownerALogin.body.data.token as string;
    const meA = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .expect(200);
    const ownerAId = meA.body.data.id as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Dono B", email: ownerBEmail, password: "SenhaSegura123", phone: "91999999003" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerBEmail]);
    const ownerBLogin = await request(app)
      .post("/auth/login")
      .send({ email: ownerBEmail, password: "SenhaSegura123" })
      .expect(200);
    const ownerBToken = ownerBLogin.body.data.token as string;

    const arenaActive = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(arenaPayload("Arena Norte Sports", "Belém", "PA"))
      .expect(201);
    const arenaActiveId = arenaActive.body.data.id as string;

    const arenaInactive = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(arenaPayload("Arena Sul Inativa", "Ananindeua", "PA"))
      .expect(201);
    const arenaInactiveId = arenaInactive.body.data.id as string;
    await request(app)
      .patch(`/arenas/${arenaInactiveId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "INACTIVE" })
      .expect(200);

    await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send(arenaPayload("Arena do B", "Marituba", "PA"))
      .expect(201);

    await request(app).get("/users/me/arenas").expect(401);

    const forbiddenUser = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
    expect(forbiddenUser.body.success).toBe(false);

    const listA = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ limit: 50 })
      .expect(200);

    expect(listA.body.success).toBe(true);
    expect(listA.body.meta).toMatchObject({ page: 1, limit: 50, sort: "updatedAt", order: "desc" });
    const idsA = (listA.body.data as { id: string }[]).map((a) => a.id);
    expect(idsA).toContain(arenaActiveId);
    expect(idsA).toContain(arenaInactiveId);

    for (const item of listA.body.data as Record<string, unknown>[]) {
      expect(item.ownerId).toBe(ownerAId);
      expect(item.document).toBeUndefined();
      expect(item.policy).toBeUndefined();
      expect(item.phone).toBeUndefined();
      expect(item.email).toBeUndefined();
      expect(item.address).toBeUndefined();
    }

    const listB = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerBToken}`)
      .expect(200);
    const idsB = (listB.body.data as { id: string }[]).map((a) => a.id);
    expect(idsB).not.toContain(arenaActiveId);
    expect(idsB).not.toContain(arenaInactiveId);

    const ignoreOwner = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ ownerId: crypto.randomUUID(), limit: 50 })
      .expect(200);
    expect((ignoreOwner.body.data as { id: string }[]).map((a) => a.id)).toContain(arenaActiveId);

    const byStatus = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ status: "INACTIVE", limit: 50 })
      .expect(200);
    expect((byStatus.body.data as { id: string }[]).map((a) => a.id)).toEqual([arenaInactiveId]);

    const byCity = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ city: "Belém", limit: 50 })
      .expect(200);
    expect((byCity.body.data as { id: string }[]).map((a) => a.id)).toEqual([arenaActiveId]);

    const byQName = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ q: "Norte", limit: 50 })
      .expect(200);
    expect((byQName.body.data as { id: string }[]).map((a) => a.id)).toEqual([arenaActiveId]);

    const detail = await request(app).get(`/arenas/${arenaActiveId}`).expect(200);
    const slug = detail.body.data.slug as string;

    const byQSlug = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ q: slug.slice(0, 12), limit: 50 })
      .expect(200);
    expect((byQSlug.body.data as { id: string }[]).map((a) => a.id)).toContain(arenaActiveId);

    const byQCity = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ q: "Ananindeua", limit: 50 })
      .expect(200);
    expect((byQCity.body.data as { id: string }[]).map((a) => a.id)).toEqual([arenaInactiveId]);

    const page1 = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ page: 1, limit: 1, sort: "name", order: "asc" })
      .expect(200);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.meta.total).toBe(2);

    const page2 = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .query({ page: 2, limit: 1, sort: "name", order: "asc" })
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    const pagedIds = [
      ...(page1.body.data as { id: string }[]).map((a) => a.id),
      ...(page2.body.data as { id: string }[]).map((a) => a.id)
    ];
    expect(new Set(pagedIds).size).toBe(2);

    const emails = [ownerAEmail, ownerBEmail, userEmail];
    await pool.query(`DELETE FROM arenas WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });
});
