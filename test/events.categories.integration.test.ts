import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

describe("sprint 03 — categorias e eventos (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[events.categories.integration] Postgres indisponível: pulando testes.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    pool = maybePool;
    await runMigrations(pool, logger);
    app = createApp({ pool, env });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("CRUD categorias (admin), listagem pública, eventos e permissões", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `admin_${suffix}@example.com`;
    const userEmail = `org_${suffix}@example.com`;
    const otherEmail = `other_${suffix}@example.com`;
    const slug = `futebol-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin Teste",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91999999999"
      })
      .expect(201);

    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);

    const adminLogin = await request(app)
      .post("/auth/login")
      .send({ email: adminEmail, password: "SenhaSegura123" })
      .expect(200);
    const adminToken = adminLogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Organizador",
        email: userEmail,
        password: "SenhaSegura123",
        phone: "91999999998"
      })
      .expect(201);

    const userLogin = await request(app)
      .post("/auth/login")
      .send({ email: userEmail, password: "SenhaSegura123" })
      .expect(200);
    const userToken = userLogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Outro",
        email: otherEmail,
        password: "SenhaSegura123",
        phone: "91999999997"
      })
      .expect(201);

    const otherLogin = await request(app)
      .post("/auth/login")
      .send({ email: otherEmail, password: "SenhaSegura123" })
      .expect(200);
    const otherToken = otherLogin.body.data.token as string;

    const forbiddenCat = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "X", slug: "x", icon: "x" })
      .expect(403);
    expect(forbiddenCat.body.success).toBe(false);

    const createCat = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Futebol", slug, icon: "football" })
      .expect(201);
    expect(createCat.body.data).toMatchObject({ name: "Futebol", slug, status: "ACTIVE" });

    const dupSlug = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Futebol 2", slug, icon: "ball" })
      .expect(409);
    expect(dupSlug.body.error.code).toBe("SLUG_ALREADY_EXISTS");

    const listCat = await request(app).get("/categories").expect(200);
    expect(listCat.body.success).toBe(true);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === slug)?.id;
    expect(categoryId).toBeTruthy();

    const start = "2026-06-10T18:00:00.000Z";
    const end = "2026-06-10T20:00:00.000Z";

    const paid = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        categoryId,
        title: "Pelada paga",
        description: "Teste",
        type: "PAID",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: start,
        endAt: end,
        addressName: "Praça",
        street: "Praça X",
        number: "s/n",
        district: "Centro",
        city: "Belém",
        state: "PA",
        capacity: 20,
        pricePerPerson: 10
      })
      .expect(201);
    expect(paid.body.data).toMatchObject({ type: "PAID", visibility: "PUBLIC", status: "PUBLISHED" });
    const eventPaidId = paid.body.data.id as string;

    const privateCreate = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        categoryId,
        title: "Rascunho privado",
        type: "FREE",
        visibility: "PRIVATE",
        sourceType: "FREE_LOCATION",
        status: "DRAFT",
        startAt: start,
        endAt: end,
        addressName: "Local",
        street: "Rua A",
        number: "1",
        district: "B",
        city: "Belém",
        state: "PA",
        capacity: 10
      })
      .expect(201);
    const privateId = privateCreate.body.data.id as string;
    const privateCode = privateCreate.body.data.privateCode as string;
    expect(privateId.length).toBeGreaterThan(10);
    expect(privateCode.length).toBeGreaterThanOrEqual(8);

    const listEvents = await request(app).get("/events").expect(200);
    expect(listEvents.body.success).toBe(true);
    expect(listEvents.body.meta).toMatchObject({
      page: 1,
      limit: 10,
      sort: "startAt",
      order: "asc"
    });
    const ids = (listEvents.body.data as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(eventPaidId);
    expect(ids).not.toContain(privateId);

    const detail = await request(app).get(`/events/${eventPaidId}`).expect(200);
    expect(detail.body.data.title).toBe("Pelada paga");

    const privAnon = await request(app).get(`/events/${privateId}`).expect(403);
    expect(privAnon.body.success).toBe(false);

    const privWrongCode = await request(app)
      .get(`/events/${privateId}`)
      .query({ privateCode: "codigo-errado-999" })
      .expect(403);
    expect(privWrongCode.body.success).toBe(false);

    const privWithCode = await request(app)
      .get(`/events/${privateId}`)
      .query({ privateCode })
      .expect(200);
    expect(privWithCode.body.data.visibility).toBe("PRIVATE");
    expect(privWithCode.body.data.privateCode).toBeUndefined();

    const privOwner = await request(app)
      .get(`/events/${privateId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(privOwner.body.data.visibility).toBe("PRIVATE");
    expect(typeof privOwner.body.data.privateCode).toBe("string");

    await request(app)
      .patch(`/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE" })
      .expect(200);

    const inactiveEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        categoryId,
        title: "Não deve criar",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "DRAFT",
        startAt: start,
        endAt: end,
        addressName: "X",
        street: "Y",
        number: "1",
        district: "Z",
        city: "Belém",
        state: "PA",
        capacity: 5
      })
      .expect(422);
    expect(inactiveEv.body.error.code).toBe("INACTIVE_CATEGORY");

    await request(app)
      .patch(`/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACTIVE" })
      .expect(200);

    const patchOther = await request(app)
      .patch(`/events/${eventPaidId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Hack" })
      .expect(403);
    expect(patchOther.body.success).toBe(false);

    const patchOk = await request(app)
      .patch(`/events/${eventPaidId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ title: "Pelada paga atualizada" })
      .expect(200);
    expect(patchOk.body.data).toMatchObject({ title: "Pelada paga atualizada" });

    const cancel = await request(app)
      .delete(`/events/${eventPaidId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(cancel.body.data).toMatchObject({ status: "CANCELLED" });

    const detailCancelled = await request(app).get(`/events/${eventPaidId}`).expect(200);
    expect(detailCancelled.body.data.status).toBe("CANCELLED");

    const patchAfterCancel = await request(app)
      .patch(`/events/${eventPaidId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ title: "Não deve" })
      .expect(422);
    expect(patchAfterCancel.body.success).toBe(false);

    const patchCat = await request(app)
      .patch(`/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Futebol atualizado" })
      .expect(200);
    expect(patchCat.body.data.name).toBe("Futebol atualizado");

    const emails = [adminEmail, userEmail, otherEmail];
    await pool.query(
      `DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [slug]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });
});
