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

  it("criação de evento FREE público publicado", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_free_${suffix}@example.com`;
    const userEmail = `usr_free_${suffix}@example.com`;
    const slug = `natacao-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin Free",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91999999901"
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
        name: "Org Free",
        email: userEmail,
        password: "SenhaSegura123",
        phone: "91999999902"
      })
      .expect(201);
    const userLogin = await request(app)
      .post("/auth/login")
      .send({ email: userEmail, password: "SenhaSegura123" })
      .expect(200);
    const userToken = userLogin.body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Natação", slug, icon: "pool" })
      .expect(201);

    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === slug)?.id;
    expect(categoryId).toBeTruthy();

    const start = "2026-08-15T10:00:00.000Z";
    const end = "2026-08-15T12:00:00.000Z";

    const freeEv = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        categoryId,
        title: "Treino FREE",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: start,
        endAt: end,
        addressName: "Piscina",
        street: "Rua das Águas",
        number: "10",
        district: "Nazaré",
        city: "Belém",
        state: "PA",
        capacity: 15
      })
      .expect(201);
    expect(freeEv.body.data).toMatchObject({ type: "FREE", visibility: "PUBLIC", status: "PUBLISHED" });
    const eventId = freeEv.body.data.id as string;

    const list = await request(app).get("/events").expect(200);
    const ids = (list.body.data as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(eventId);

    const emails = [adminEmail, userEmail];
    await pool.query(
      `DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [slug]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });

  it("GET /events: filtros category, city, type, dateFrom/dateTo, order desc e paginação", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_flt_${suffix}@example.com`;
    const userEmail = `usr_flt_${suffix}@example.com`;
    const slugA = `modal-a-${suffix.slice(0, 8)}`;
    const slugB = `modal-b-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin Filtro",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91999999801"
      })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Org Filtro",
        email: userEmail,
        password: "SenhaSegura123",
        phone: "91999999802"
      })
      .expect(201);
    const userToken = (
      await request(app).post("/auth/login").send({ email: userEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Modal A", slug: slugA, icon: "a" })
      .expect(201);
    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Modal B", slug: slugB, icon: "b" })
      .expect(201);

    const listCat = await request(app).get("/categories").expect(200);
    const rows = listCat.body.data as { id: string; slug: string }[];
    const catA = rows.find((c) => c.slug === slugA)?.id;
    const catB = rows.find((c) => c.slug === slugB)?.id;
    expect(catA && catB).toBeTruthy();

    const baseAddr = {
      sourceType: "FREE_LOCATION",
      status: "PUBLISHED" as const,
      visibility: "PUBLIC" as const,
      addressName: "Local",
      street: "Rua 1",
      number: "1",
      district: "Centro",
      state: "PA" as const,
      capacity: 10
    };

    const cityBelem = `Belém-${suffix.slice(0, 8)}`;
    const cityManaus = `Manaus-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...baseAddr,
        categoryId: catA,
        title: "Evento Belém PAID julho",
        type: "PAID",
        startAt: "2026-07-05T18:00:00.000Z",
        endAt: "2026-07-05T20:00:00.000Z",
        city: cityBelem,
        pricePerPerson: 25
      })
      .expect(201);

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...baseAddr,
        categoryId: catA,
        title: "Segundo mesmo cat julho",
        type: "PAID",
        startAt: "2026-07-20T18:00:00.000Z",
        endAt: "2026-07-20T20:00:00.000Z",
        city: cityBelem,
        pricePerPerson: 30
      })
      .expect(201);

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...baseAddr,
        categoryId: catB,
        title: "Evento Manaus FREE agosto",
        type: "FREE",
        startAt: "2026-08-20T14:00:00.000Z",
        endAt: "2026-08-20T16:00:00.000Z",
        city: cityManaus
      })
      .expect(201);

    const byCatA = await request(app).get("/events").query({ category: catA }).expect(200);
    const titlesCatA = (byCatA.body.data as { title: string }[]).map((e) => e.title);
    expect(titlesCatA).toContain("Evento Belém PAID julho");
    expect(titlesCatA).toContain("Segundo mesmo cat julho");

    const byCity = await request(app).get("/events").query({ city: cityManaus }).expect(200);
    expect(byCity.body.data.every((e: { city: string }) => e.city === cityManaus)).toBe(true);

    const byTypeFree = await request(app).get("/events").query({ type: "FREE", city: cityManaus }).expect(200);
    expect(byTypeFree.body.data.length).toBeGreaterThanOrEqual(1);
    expect(byTypeFree.body.data.every((e: { type: string }) => e.type === "FREE")).toBe(true);

    const byDate = await request(app)
      .get("/events")
      .query({
        category: catA,
        dateFrom: "2026-07-01T00:00:00.000Z",
        dateTo: "2026-07-31T23:59:59.999Z"
      })
      .expect(200);
    expect(byDate.body.data.length).toBeGreaterThanOrEqual(2);
    expect(
      (byDate.body.data as { startAt: string }[]).every(
        (e) =>
          new Date(e.startAt) >= new Date("2026-07-01T00:00:00.000Z") &&
          new Date(e.startAt) <= new Date("2026-07-31T23:59:59.999Z")
      )
    ).toBe(true);

    const desc = await request(app).get("/events").query({ category: catA, order: "desc", limit: 10 }).expect(200);
    expect(desc.body.meta.order).toBe("desc");
    const first = (desc.body.data as { startAt: string }[])[0];
    expect(new Date(first.startAt).toISOString()).toContain("2026-07-20");

    const page1 = await request(app).get("/events").query({ city: cityManaus, limit: 1, page: 1 }).expect(200);
    expect(page1.body.data.length).toBe(1);
    expect(page1.body.meta.total).toBeGreaterThanOrEqual(1);

    const emails = [adminEmail, userEmail];
    await pool.query(
      `DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool.query(`DELETE FROM event_categories WHERE slug = ANY($1::text[])`, [[slugA, slugB]]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });

  it("GET /events/:id inexistente retorna 404", async () => {
    if (!pool || !app) return;
    const missing = "00000000-0000-4000-8000-000000000099";
    const res = await request(app).get(`/events/${missing}`).expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("POST /events: validações (pago sem preço, FREE com preço, datas inválidas)", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_val_${suffix}@example.com`;
    const userEmail = `usr_val_${suffix}@example.com`;
    const slug = `corrida-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin Val",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91999999701"
      })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Org Val",
        email: userEmail,
        password: "SenhaSegura123",
        phone: "91999999702"
      })
      .expect(201);
    const userToken = (
      await request(app).post("/auth/login").send({ email: userEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Corrida", slug, icon: "run" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === slug)?.id;
    expect(categoryId).toBeTruthy();

    const base = {
      categoryId,
      title: "X",
      visibility: "PUBLIC" as const,
      sourceType: "FREE_LOCATION" as const,
      status: "DRAFT" as const,
      addressName: "A",
      street: "B",
      number: "1",
      district: "C",
      city: "Belém",
      state: "PA" as const,
      capacity: 10
    };

    const paidNoPrice = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...base,
        title: "Pago sem preço",
        type: "PAID",
        startAt: "2026-09-01T10:00:00.000Z",
        endAt: "2026-09-01T12:00:00.000Z"
      })
      .expect(400);
    expect(paidNoPrice.body.success).toBe(false);
    expect(paidNoPrice.body.error.code).toBe("VALIDATION_ERROR");

    const freeWithPrice = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...base,
        title: "Free com preço",
        type: "FREE",
        startAt: "2026-09-02T10:00:00.000Z",
        endAt: "2026-09-02T12:00:00.000Z",
        pricePerPerson: 5
      })
      .expect(400);
    expect(freeWithPrice.body.error.code).toBe("VALIDATION_ERROR");

    const badDates = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...base,
        title: "Datas ruins",
        type: "FREE",
        startAt: "2026-09-03T14:00:00.000Z",
        endAt: "2026-09-03T10:00:00.000Z"
      })
      .expect(400);
    expect(badDates.body.error.code).toBe("VALIDATION_ERROR");

    const unknownCat = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        ...base,
        categoryId: "00000000-0000-4000-8000-000000000088",
        title: "Cat inexistente",
        type: "FREE",
        startAt: "2026-09-04T10:00:00.000Z",
        endAt: "2026-09-04T12:00:00.000Z"
      })
      .expect(422);
    expect(unknownCat.body.error.code).toBe("INVALID_CATEGORY");

    const emails = [adminEmail, userEmail];
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [slug]);
  });

  it("DELETE /categories com eventos vinculados retorna 409", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_del_${suffix}@example.com`;
    const userEmail = `usr_del_${suffix}@example.com`;
    const slug = `futsal-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin Del",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91999999601"
      })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminToken = (
      await request(app).post("/auth/login").send({ email: adminEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Org Del",
        email: userEmail,
        password: "SenhaSegura123",
        phone: "91999999602"
      })
      .expect(201);
    const userToken = (
      await request(app).post("/auth/login").send({ email: userEmail, password: "SenhaSegura123" })
    ).body.data.token as string;

    const catRes = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Futsal", slug, icon: "ball" })
      .expect(201);
    const categoryId = catRes.body.data.id as string;

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        categoryId,
        title: "Evento para bloquear delete",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "DRAFT",
        startAt: "2026-10-01T10:00:00.000Z",
        endAt: "2026-10-01T12:00:00.000Z",
        addressName: "Q",
        street: "R",
        number: "1",
        district: "S",
        city: "Belém",
        state: "PA",
        capacity: 8
      })
      .expect(201);

    const del409 = await request(app)
      .delete(`/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(409);
    expect(del409.body.error.code).toBe("CATEGORY_IN_USE");

    const emails = [adminEmail, userEmail];
    await pool.query(
      `DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await request(app).delete(`/categories/${categoryId}`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });
});
