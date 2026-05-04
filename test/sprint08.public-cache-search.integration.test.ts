import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { PUBLIC_CATALOG_CACHE_VERSION_KEY } from "../src/shared/cache/public-catalog-cache";
import { createRedisClient } from "../src/shared/cache/redis/redis";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

describe("sprint 08 — busca pública, q e cache de catálogo (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let redis: ReturnType<typeof createRedisClient> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);
    const maybeRedis = createRedisClient(env.redis);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint08] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    try {
      await maybeRedis.connect();
      await maybeRedis.ping();
    } catch {
      console.warn("[sprint08] Redis indisponível: pulando testes.");
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

  it("GET /events?q encontra por título e descrição; vazio sem match; validação de tamanho", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s08_${suffix}@example.com`;
    const orgEmail = `org_s08_${suffix}@example.com`;
    const slug = `cat-s08-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91800000001"
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
      .send({ name: "Cat S08", slug, icon: "ball" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === slug)?.id as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Org", email: orgEmail, password: "SenhaSegura123", phone: "91800000002" })
      .expect(201);
    const orgLogin = await request(app)
      .post("/auth/login")
      .send({ email: orgEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgToken = orgLogin.body.data.token as string;

    const uniqueTitle = `PeladaZeta${suffix.slice(0, 8)}`;
    const uniqueDesc = `DescriçãoGamma${suffix.slice(0, 8)} para busca`;

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({
        categoryId,
        title: uniqueTitle,
        description: uniqueDesc,
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: "2028-09-01T18:00:00.000Z",
        endAt: "2028-09-01T20:00:00.000Z",
        addressName: "Quadra",
        street: "Rua X",
        number: "1",
        district: "Centro",
        city: "Belém",
        state: "PA",
        capacity: 20
      })
      .expect(201);

    const byTitle = await request(app).get("/events").query({ q: uniqueTitle }).expect(200);
    expect(byTitle.body.meta.total).toBeGreaterThanOrEqual(1);
    expect((byTitle.body.data as { title: string }[]).some((e) => e.title === uniqueTitle)).toBe(true);

    const byDesc = await request(app).get("/events").query({ q: "Gamma" + suffix.slice(0, 8) }).expect(200);
    expect(byDesc.body.meta.total).toBeGreaterThanOrEqual(1);

    const none = await request(app).get("/events").query({ q: "ZZZ_NO_MATCH_" + suffix }).expect(200);
    expect(none.body.data).toEqual([]);
    expect(none.body.meta.total).toBe(0);

    const longQ = "a".repeat(201);
    const bad = await request(app).get("/events").query({ q: longQ }).expect(400);
    expect(bad.body.success).toBe(false);

    const emails = [adminEmail, orgEmail];
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [slug]);
  });

  it("invalidação de cache: PATCH categoria reflete em GET /categories", async () => {
    if (!pool || !redis || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s08b_${suffix}@example.com`;
    const slug = `cat-s08b-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin B",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91800000003"
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
      .send({ name: "Nome Antigo", slug, icon: "ball" })
      .expect(201);

    const c1 = await request(app).get("/categories").expect(200);
    const row = (c1.body.data as { id: string; name: string }[]).find((x) => x.slug === slug);
    expect(row?.name).toBe("Nome Antigo");

    const catId = row!.id;

    await request(app)
      .patch(`/categories/${catId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Nome Novo" })
      .expect(200);

    const c2 = await request(app).get("/categories").expect(200);
    const row2 = (c2.body.data as { id: string; name: string }[]).find((x) => x.id === catId);
    expect(row2?.name).toBe("Nome Novo");

    await pool.query(`DELETE FROM event_categories WHERE id = $1`, [catId]);
    await pool.query(`DELETE FROM users WHERE email = $1`, [adminEmail]);
    await redis.del(PUBLIC_CATALOG_CACHE_VERSION_KEY).catch(() => undefined);
  });
});
