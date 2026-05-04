import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

const arenaPayload = {
  name: "Arena Teste Integração",
  description: "Descrição",
  phone: "91988887777",
  email: "arena-teste@example.com",
  document: "12345678000199",
  address: {
    zipCode: "66000-000",
    street: "Av. Teste",
    number: "100",
    district: "Centro",
    city: "Belém",
    state: "PA"
  },
  policy: {
    allowRecurring: true,
    minAdvanceHours: 2,
    minReservationPaymentPercent: 30
  }
};

describe("sprint 04 — arenas, spaces e slots (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint04.arenas] Postgres indisponível: pulando testes.");
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

  it("fluxo arena → space → slots, sobreposição 403/409 e permissões", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const ownerEmail = `owner_${suffix}@example.com`;
    const otherEmail = `other_${suffix}@example.com`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Dono Arena",
        email: ownerEmail,
        password: "SenhaSegura123",
        phone: "91999999001"
      })
      .expect(201);
    await pool.query(`UPDATE users SET role = 'arena_owner' WHERE email = $1`, [ownerEmail]);

    const ownerLogin = await request(app)
      .post("/auth/login")
      .send({ email: ownerEmail, password: "SenhaSegura123" })
      .expect(200);
    const ownerToken = ownerLogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Outro user",
        email: otherEmail,
        password: "SenhaSegura123",
        phone: "91999999002"
      })
      .expect(201);
    const otherLogin = await request(app)
      .post("/auth/login")
      .send({ email: otherEmail, password: "SenhaSegura123" })
      .expect(200);
    const otherToken = otherLogin.body.data.token as string;

    const forbiddenArena = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${otherToken}`)
      .send(arenaPayload)
      .expect(403);
    expect(forbiddenArena.body.success).toBe(false);

    const createArenaRes = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(arenaPayload)
      .expect(201);
    expect(createArenaRes.body.data).toMatchObject({ status: "ACTIVE" });
    const arenaId = createArenaRes.body.data.id as string;

    const detail = await request(app).get(`/arenas/${arenaId}`).expect(200);
    expect(detail.body.data.name).toBe(arenaPayload.name);
    expect(detail.body.data.address.city).toBe("Belém");
    expect(detail.body.data.policy.minAdvanceHours).toBe(2);

    const patchOther = await request(app)
      .patch(`/arenas/${arenaId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "Hack" })
      .expect(403);
    expect(patchOther.body.success).toBe(false);

    await request(app)
      .patch(`/arenas/${arenaId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Arena Atualizada" })
      .expect(200);

    const spaceRes = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Quadra 1", type: "court", capacitySuggestion: 10 })
      .expect(201);
    const spaceId = spaceRes.body.data.id as string;

    const listSpaces = await request(app).get(`/arenas/${arenaId}/spaces`).expect(200);
    expect(listSpaces.body.data.length).toBeGreaterThanOrEqual(1);

    const slot1 = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: "2026-11-10T18:00:00.000Z",
        endAt: "2026-11-10T19:00:00.000Z",
        price: 120,
        allowsRecurring: true,
        notes: "Noite"
      })
      .expect(201);
    expect(slot1.body.data).toMatchObject({ status: "AVAILABLE" });

    const overlap = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: "2026-11-10T18:30:00.000Z",
        endAt: "2026-11-10T19:30:00.000Z",
        price: 50,
        allowsRecurring: false
      })
      .expect(409);
    expect(overlap.body.error.code).toBe("SLOT_OVERLAP");

    const slotOther = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({
        startAt: "2026-11-11T10:00:00.000Z",
        endAt: "2026-11-11T11:00:00.000Z",
        price: 10,
        allowsRecurring: false
      })
      .expect(403);
    expect(slotOther.body.success).toBe(false);

    const listBySpace = await request(app).get(`/spaces/${spaceId}/slots`).expect(200);
    expect(listBySpace.body.meta.total).toBeGreaterThanOrEqual(1);

    const listByArena = await request(app)
      .get(`/arenas/${arenaId}/slots`)
      .query({ dateFrom: "2026-11-01T00:00:00.000Z", dateTo: "2026-11-30T23:59:59.999Z" })
      .expect(200);
    expect(listByArena.body.data.length).toBeGreaterThanOrEqual(1);

    const emails = [ownerEmail, otherEmail];
    await pool.query(
      `DELETE FROM arena_slots WHERE space_id IN (SELECT id FROM arena_spaces WHERE arena_id = $1)`,
      [arenaId]
    );
    await pool.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
  });
});
