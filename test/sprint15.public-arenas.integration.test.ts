import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createStubRedisClient } from "./test-deps";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

const arenaPayload = (
  name: string,
  opts: { city: string; state: string; district: string; street: string; email: string }
) => ({
  name,
  description: "Arena pública teste",
  phone: "91988887777",
  email: opts.email,
  document: "12345678000199",
  address: {
    zipCode: "66000-000",
    street: opts.street,
    number: "100",
    district: opts.district,
    city: opts.city,
    state: opts.state
  },
  policy: {
    allowRecurring: true,
    minAdvanceHours: 2,
    minReservationPaymentPercent: 30
  }
});

describe("sprint 15 — public arenas discovery (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint15.public-arenas] Postgres indisponível: pulando testes.");
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

  it("GET /arenas — catálogo público, filtros, payload e regressão", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const ownerEmail = `owner_s15_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Dono S15", email: ownerEmail, password: "SenhaSegura123", phone: "91999999001" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);
    const ownerToken = (
      await request(app).post("/auth/login").send({ email: ownerEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    const activeName = `ArenaPublica${suffix.slice(0, 8)}`;
    const inactiveName = `ArenaInativa${suffix.slice(0, 8)}`;
    const cityTag = `CidadeS15${suffix.slice(0, 6)}`;

    const activeRes = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(
        arenaPayload(activeName, {
          city: cityTag,
          state: "PA",
          district: "Nazaré",
          street: "Av. Descoberta Norte",
          email: `active-${suffix}@arena.example.com`
        })
      )
      .expect(201);
    const activeId = activeRes.body.data.id as string;

    const inactiveRes = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(
        arenaPayload(inactiveName, {
          city: cityTag,
          state: "PA",
          district: "Marco",
          street: "Rua Oculta",
          email: `inactive-${suffix}@arena.example.com`
        })
      )
      .expect(201);
    const inactiveId = inactiveRes.body.data.id as string;
    await request(app)
      .patch(`/arenas/${inactiveId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "INACTIVE" })
      .expect(200);

    const list = await request(app).get("/arenas").query({ city: cityTag, limit: 50 }).expect(200);
    expect(list.body.success).toBe(true);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 50, sort: "updatedAt", order: "desc" });

    const ids = (list.body.data as { id: string }[]).map((a) => a.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(inactiveId);

    for (const item of list.body.data as Record<string, unknown>[]) {
      expect(item.status).toBe("ACTIVE");
      expect(item.ownerId).toBeUndefined();
      expect(item.document).toBeUndefined();
      expect(item.policy).toBeUndefined();
      expect(item.phone).toBeUndefined();
      expect(item.email).toBeUndefined();
    }

    const byQName = await request(app).get("/arenas").query({ q: activeName, limit: 50 }).expect(200);
    expect((byQName.body.data as { id: string }[]).map((a) => a.id)).toContain(activeId);

    const detail = await request(app).get(`/arenas/${activeId}`).expect(200);
    const slug = detail.body.data.slug as string;
    const byQSlug = await request(app).get("/arenas").query({ q: slug.slice(0, 10), limit: 50 }).expect(200);
    expect((byQSlug.body.data as { id: string }[]).map((a) => a.id)).toContain(activeId);

    const byQStreet = await request(app)
      .get("/arenas")
      .query({ q: "Descoberta", limit: 50 })
      .expect(200);
    expect((byQStreet.body.data as { id: string }[]).map((a) => a.id)).toContain(activeId);

    const byState = await request(app).get("/arenas").query({ state: "PA", q: activeName, limit: 50 }).expect(200);
    expect((byState.body.data as { id: string }[]).map((a) => a.id)).toContain(activeId);

    const byDistrict = await request(app)
      .get("/arenas")
      .query({ district: "Nazaré", q: activeName, limit: 50 })
      .expect(200);
    expect((byDistrict.body.data as { id: string }[]).map((a) => a.id)).toContain(activeId);

    const page1 = await request(app)
      .get("/arenas")
      .query({ city: cityTag, page: 1, limit: 1, sort: "name", order: "asc" })
      .expect(200);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.meta.total).toBeGreaterThanOrEqual(1);

    const ownerList = await request(app)
      .get("/users/me/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ limit: 50 })
      .expect(200);
    const ownerIds = (ownerList.body.data as { id: string }[]).map((a) => a.id);
    expect(ownerIds).toContain(activeId);
    expect(ownerIds).toContain(inactiveId);

    await pool.query(`DELETE FROM arenas WHERE id = ANY($1::uuid[])`, [[activeId, inactiveId]]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [ownerEmail]);
  });
});
