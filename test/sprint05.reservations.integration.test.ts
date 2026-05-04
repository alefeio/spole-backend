import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

const arenaPayload = {
  name: "Arena Sprint 05",
  description: "Teste",
  phone: "91988881111",
  email: "arena-s05@example.com",
  document: "98765432000188",
  address: {
    zipCode: "66000-000",
    street: "Rua Reserva",
    number: "50",
    district: "Centro",
    city: "Belém",
    state: "PA"
  },
  policy: {
    allowRecurring: false,
    minAdvanceHours: 0,
    minReservationPaymentPercent: 0
  }
};

describe("sprint 05 — reservas, slots e eventos em arena (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[sprint05.reservations] Postgres indisponível: pulando testes.");
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

  it("reserva slot, listagens, cancelamento, evento com reservationId e permissões", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const adminEmail = `adm_s05_${suffix}@example.com`;
    const ownerEmail = `own_s05_${suffix}@example.com`;
    const orgEmail = `org_s05_${suffix}@example.com`;
    const otherEmail = `oth_s05_${suffix}@example.com`;
    const catSlug = `cat-s05-${suffix.slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Admin S05",
        email: adminEmail,
        password: "SenhaSegura123",
        phone: "91900000001"
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
      .send({ name: "Categoria S05", slug: catSlug, icon: "ball" })
      .expect(201);
    const listCat = await request(app).get("/categories").expect(200);
    const categoryId = (listCat.body.data as { id: string; slug: string }[]).find((c) => c.slug === catSlug)?.id;
    expect(categoryId).toBeTruthy();

    await request(app)
      .post("/auth/register")
      .send({
        name: "Dono Arena",
        email: ownerEmail,
        password: "SenhaSegura123",
        phone: "91900000002"
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
        name: "Organizador",
        email: orgEmail,
        password: "SenhaSegura123",
        phone: "91900000003"
      })
      .expect(201);
    const orgLogin = await request(app)
      .post("/auth/login")
      .send({ email: orgEmail, password: "SenhaSegura123" })
      .expect(200);
    const orgToken = orgLogin.body.data.token as string;

    await request(app)
      .post("/auth/register")
      .send({
        name: "Outro",
        email: otherEmail,
        password: "SenhaSegura123",
        phone: "91900000004"
      })
      .expect(201);
    const otherLogin = await request(app)
      .post("/auth/login")
      .send({ email: otherEmail, password: "SenhaSegura123" })
      .expect(200);
    const otherToken = otherLogin.body.data.token as string;

    const arenaRes = await request(app)
      .post("/arenas")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(arenaPayload)
      .expect(201);
    const arenaId = arenaRes.body.data.id as string;

    const spaceRes = await request(app)
      .post(`/arenas/${arenaId}/spaces`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Quadra S05", type: "court", capacitySuggestion: 12 })
      .expect(201);
    const spaceId = spaceRes.body.data.id as string;

    const slotStart = "2026-12-01T14:00:00.000Z";
    const slotEnd = "2026-12-01T15:00:00.000Z";
    const slotRes = await request(app)
      .post(`/spaces/${spaceId}/slots`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        startAt: slotStart,
        endAt: slotEnd,
        price: 80,
        allowsRecurring: false
      })
      .expect(201);
    const slotId = slotRes.body.data.id as string;

    const denyArenaList = await request(app)
      .get(`/arenas/${arenaId}/reservations`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(403);
    expect(denyArenaList.body.success).toBe(false);

    const resv = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(201);
    expect(resv.body.data).toMatchObject({
      status: "CONFIRMED",
      type: "SINGLE",
      slotId
    });
    const reservationId = resv.body.data.id as string;

    const dup = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(409);
    expect(dup.body.error.code).toBe("SLOT_UNAVAILABLE");

    const slotRow = await pool.query<{ status: string }>(
      `SELECT status::text FROM arena_slots WHERE id = $1`,
      [slotId]
    );
    expect(slotRow.rows[0]?.status).toBe("RESERVED");

    const me = await request(app).get("/reservations/me").set("Authorization", `Bearer ${orgToken}`).expect(200);
    expect(Array.isArray(me.body.data)).toBe(true);
    expect((me.body.data as { id: string }[]).some((r) => r.id === reservationId)).toBe(true);

    const arenaList = await request(app)
      .get(`/arenas/${arenaId}/reservations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect((arenaList.body.data as { id: string }[]).some((r) => r.id === reservationId)).toBe(true);

    const getOrg = await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);
    expect(getOrg.body.data.id).toBe(reservationId);

    const getOwner = await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(getOwner.body.data.status).toBe("CONFIRMED");

    const getForbidden = await request(app)
      .get(`/reservations/${reservationId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);
    expect(getForbidden.body.success).toBe(false);

    const stealEvent = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({
        categoryId,
        reservationId,
        title: "Roubo",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "ARENA_RESERVATION",
        status: "PUBLISHED",
        capacity: 10
      })
      .expect(403);
    expect(stealEvent.body.error.code).toBe("FORBIDDEN");

    const cancelOther = await request(app)
      .patch(`/reservations/${reservationId}/cancel`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);
    expect(cancelOther.body.success).toBe(false);

    const eventRes = await request(app)
      .post("/events")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({
        categoryId,
        reservationId,
        title: "Pelada na arena",
        description: "Reserva válida",
        type: "FREE",
        visibility: "PUBLIC",
        sourceType: "ARENA_RESERVATION",
        status: "PUBLISHED",
        capacity: 10
      })
      .expect(201);
    const eventId = eventRes.body.data.id as string;

    const resConsumed = await pool.query<{ status: string }>(
      `SELECT status::text FROM reservations WHERE id = $1`,
      [reservationId]
    );
    expect(resConsumed.rows[0]?.status).toBe("CONSUMED");

    const cancelConsumed = await request(app)
      .patch(`/reservations/${reservationId}/cancel`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(422);
    expect(cancelConsumed.body.error.code).toBe("RESERVATION_ALREADY_CONSUMED");

    const detail = await request(app).get(`/events/${eventId}`).expect(200);
    expect(detail.body.data.sourceType).toBe("ARENA_RESERVATION");
    expect(detail.body.data.startAt).toBe(slotStart);
    expect(detail.body.data.endAt).toBe(slotEnd);

    await request(app).delete(`/events/${eventId}`).set("Authorization", `Bearer ${orgToken}`).expect(200);

    const slotAfterCancelEvent = await pool.query<{ status: string }>(
      `SELECT status::text FROM arena_slots WHERE id = $1`,
      [slotId]
    );
    expect(slotAfterCancelEvent.rows[0]?.status).toBe("AVAILABLE");

    const resv2 = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${orgToken}`)
      .send({ slotId, type: "SINGLE" })
      .expect(201);
    const reservation2Id = resv2.body.data.id as string;

    await request(app)
      .patch(`/reservations/${reservation2Id}/cancel`)
      .set("Authorization", `Bearer ${orgToken}`)
      .expect(200);

    const slotAfterResCancel = await pool.query<{ status: string }>(
      `SELECT status::text FROM arena_slots WHERE id = $1`,
      [slotId]
    );
    expect(slotAfterResCancel.rows[0]?.status).toBe("AVAILABLE");

    const emails = [adminEmail, ownerEmail, orgEmail, otherEmail];
    await pool.query(
      `DELETE FROM events WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool.query(
      `DELETE FROM reservations WHERE organizer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [emails]
    );
    await pool.query(
      `DELETE FROM arena_slots WHERE space_id IN (SELECT id FROM arena_spaces WHERE arena_id = $1)`,
      [arenaId]
    );
    await pool.query(`DELETE FROM arena_spaces WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_addresses WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arena_policies WHERE arena_id = $1`, [arenaId]);
    await pool.query(`DELETE FROM arenas WHERE id = $1`, [arenaId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    await pool.query(`DELETE FROM event_categories WHERE slug = $1`, [catSlug]);
  });
});
