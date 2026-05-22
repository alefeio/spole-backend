import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createStubRedisClient } from "./test-deps";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

describe("sprint 13 — organizer events read model (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint13.organizer-events] Postgres indisponível: pulando testes.");
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

  it("GET /users/me/events e GET /events/:id — listagem do organizador e detalhe contextual", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const orgAEmail = `org_a_${suffix}@example.com`;
    const orgBEmail = `org_b_${suffix}@example.com`;
    const adminEmail = `admin_s13_${suffix}@example.com`;
    const slug = `cat-s13-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ name: "Admin S13", email: adminEmail, password: "SenhaSegura123", phone: "91999999990" })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
    const adminLogin = await request(app)
      .post("/auth/login")
      .send({ email: adminEmail, password: "SenhaSegura123" })
      .expect(200);
    const adminToken = adminLogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Org A", email: orgAEmail, password: "SenhaSegura123", phone: "91999999991" })
      .expect(201);
    const orgALogin = await request(app)
      .post("/auth/login")
      .send({ email: orgAEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgAToken = orgALogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({ name: "Org B", email: orgBEmail, password: "SenhaSegura123", phone: "91999999992" })
      .expect(201);
    const orgBLogin = await request(app)
      .post("/auth/login")
      .send({ email: orgBEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgBToken = orgBLogin.body.data.token as string;

    const catRes = await request(app)
      .post("/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cat S13", slug, icon: "ball" })
      .expect(201);
    const categoryId = catRes.body.data.id as string;

    const startDraft = "2026-08-01T10:00:00.000Z";
    const endDraft = "2026-08-01T12:00:00.000Z";
    const startPub = "2026-09-01T10:00:00.000Z";
    const endPub = "2026-09-01T12:00:00.000Z";
    const startPriv = "2026-10-01T10:00:00.000Z";
    const endPriv = "2026-10-01T12:00:00.000Z";

    const draftRes = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({
        categoryId,
        title: "Rascunho S13 Alpha",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "DRAFT",
        startAt: startDraft,
        endAt: endDraft,
        addressName: "Campo A",
        street: "Rua Draft",
        number: "10",
        district: "Centro",
        city: "Belém",
        state: "PA",
        capacity: 8
      })
      .expect(201);
    const draftId = draftRes.body.data.id as string;

    const pubRes = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({
        categoryId,
        title: "Publicado S13 Beta",
        type: "PAID",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: startPub,
        endAt: endPub,
        addressName: "Campo B",
        street: "Rua Pub",
        number: "20",
        district: "Nazaré",
        city: "Belém",
        state: "PA",
        capacity: 12,
        pricePerPerson: 25
      })
      .expect(201);
    const pubId = pubRes.body.data.id as string;

    const privRes = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({
        categoryId,
        title: "Privado S13 Gamma",
        type: "FREE",
        visibility: "PRIVATE",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: startPriv,
        endAt: endPriv,
        addressName: "Campo C",
        street: "Rua Priv",
        number: "30",
        district: "Umarizal",
        city: "Ananindeua",
        state: "PA",
        capacity: 6
      })
      .expect(201);
    const privId = privRes.body.data.id as string;
    const privateCode = privRes.body.data.privateCode as string;

    await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgBToken}`)
      .send({
        categoryId,
        title: "Evento de B",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "FREE_LOCATION",
        status: "PUBLISHED",
        startAt: startPub,
        endAt: endPub,
        addressName: "Campo B2",
        street: "Rua B",
        number: "1",
        district: "X",
        city: "Belém",
        state: "PA",
        capacity: 5
      })
      .expect(201);

    await request(app).get("/users/me/events").expect(401);

    const listA = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ limit: 50, sort: "startAt", order: "asc" })
      .expect(200);

    expect(listA.body.success).toBe(true);
    expect(listA.body.meta).toMatchObject({ page: 1, limit: 50, sort: "startAt", order: "asc" });
    const idsA = (listA.body.data as { id: string }[]).map((e) => e.id);
    expect(idsA).toContain(draftId);
    expect(idsA).toContain(pubId);
    expect(idsA).toContain(privId);
    for (const item of listA.body.data as Record<string, unknown>[]) {
      expect(item.privateCode).toBeUndefined();
    }

    const listB = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(200);
    const idsB = (listB.body.data as { id: string; title: string }[]).map((e) => e.id);
    expect(idsB).not.toContain(draftId);
    expect(idsB).not.toContain(pubId);
    expect(idsB).not.toContain(privId);

    const listIgnoreOrganizer = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ organizerId: crypto.randomUUID(), limit: 50 })
      .expect(200);
    const idsIgnore = (listIgnoreOrganizer.body.data as { id: string }[]).map((e) => e.id);
    expect(idsIgnore).toContain(draftId);
    expect(idsIgnore).not.toContain(idsB[0]);

    const byStatus = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ status: "DRAFT", limit: 50 })
      .expect(200);
    const statusIds = (byStatus.body.data as { id: string }[]).map((e) => e.id);
    expect(statusIds).toContain(draftId);
    expect(statusIds).not.toContain(pubId);

    const byVisibility = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ visibility: "PRIVATE", limit: 50 })
      .expect(200);
    expect((byVisibility.body.data as { id: string }[]).map((e) => e.id)).toEqual([privId]);

    const byType = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ type: "PAID", limit: 50 })
      .expect(200);
    expect((byType.body.data as { id: string }[]).map((e) => e.id)).toEqual([pubId]);

    const bySource = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ sourceType: "FREE_LOCATION", limit: 50 })
      .expect(200);
    expect((bySource.body.data as { id: string }[]).map((e) => e.id).sort()).toEqual(
      [draftId, pubId, privId].sort()
    );

    const byCategory = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ categoryId, limit: 50 })
      .expect(200);
    expect((byCategory.body.data as { id: string }[]).length).toBeGreaterThanOrEqual(3);

    const byQ = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ q: "Gamma", limit: 50 })
      .expect(200);
    expect((byQ.body.data as { id: string }[]).map((e) => e.id)).toEqual([privId]);

    const byDate = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ dateFrom: startPub, dateTo: endPub, limit: 50 })
      .expect(200);
    expect((byDate.body.data as { id: string }[]).map((e) => e.id)).toContain(pubId);
    expect((byDate.body.data as { id: string }[]).map((e) => e.id)).not.toContain(draftId);

    const page1 = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ page: 1, limit: 2, sort: "startAt", order: "asc" })
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.total).toBeGreaterThanOrEqual(3);

    const page2 = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ page: 2, limit: 2, sort: "startAt", order: "asc" })
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    const pageIds = [
      ...(page1.body.data as { id: string }[]).map((e) => e.id),
      ...(page2.body.data as { id: string }[]).map((e) => e.id)
    ];
    expect(new Set(pageIds).size).toBe(3);

    const ownerDetail = await request(app)
      .get(`/events/${privId}`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .expect(200);
    expect(ownerDetail.body.data).toMatchObject({
      id: privId,
      categoryId,
      visibility: "PRIVATE",
      sourceType: "FREE_LOCATION",
      street: "Rua Priv",
      number: "30",
      district: "Umarizal",
      locationReadOnly: false
    });
    expect(ownerDetail.body.data.privateCode).toBe(privateCode);

    const anonDetail = await request(app).get(`/events/${privId}`).expect(403);

    const otherDetail = await request(app)
      .get(`/events/${privId}`)
      .set("Authorization", `Bearer ${orgBToken}`)
      .expect(403);
    expect(anonDetail.body.success).toBe(false);
    expect(otherDetail.body.success).toBe(false);

    const codeDetail = await request(app)
      .get(`/events/${privId}`)
      .query({ privateCode })
      .expect(200);
    expect(codeDetail.body.data.privateCode).toBeUndefined();
    expect(codeDetail.body.data.categoryId).toBeUndefined();
    expect(codeDetail.body.data.locationReadOnly).toBeUndefined();

    const pubVisitor = await request(app).get(`/events/${pubId}`).expect(200);
    expect(pubVisitor.body.data.privateCode).toBeUndefined();
    expect(pubVisitor.body.data.categoryId).toBeUndefined();

    const adminDetail = await request(app)
      .get(`/events/${privId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(adminDetail.body.data.categoryId).toBe(categoryId);
    expect(adminDetail.body.data.privateCode).toBe(privateCode);
    expect(adminDetail.body.data.locationReadOnly).toBe(false);

    await request(app).delete(`/events/${pubId}`).set("Authorization", `Bearer ${orgAToken}`).expect(200);

    const cancelledList = await request(app)
      .get("/users/me/events")
      .set("Authorization", `Bearer ${orgAToken}`)
      .query({ status: "CANCELLED", limit: 50 })
      .expect(200);
    expect((cancelledList.body.data as { id: string }[]).map((e) => e.id)).toContain(pubId);

    const emails = [orgAEmail, orgBEmail, adminEmail];
    await pool.query(`DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [
      emails
    ]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [slug]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });
});
