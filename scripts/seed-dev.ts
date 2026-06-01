import "dotenv/config";

import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { bumpPublicCatalogVersion } from "../src/shared/cache/public-catalog-cache";
import { createRedisClient } from "../src/shared/cache/redis/redis";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

/**
 * `loadEnv()` valida toda a configuração da API (JWT, Redis, webhook, etc.).
 * O seed só usa Postgres e migrações. Com `.env` parcial (ex.: só Postgres),
 * preenchemos defaults **apenas** quando a variável ainda não está definida.
 */
function ensureProcessEnvForApiLoadEnv() {
  process.env.JWT_SECRET ??= "seed-only-jwt-secret-not-for-production";
  process.env.PAYMENTS_WEBHOOK_SECRET ??= "seed-only-webhook-secret-not-for-production";
  process.env.REDIS_HOST ??= "localhost";
}

const PASSWORD = "SpoleDev123!";
const HASH_ROUNDS = 12;

type IdMap = Record<string, string>;

type SeedContext = {
  users: IdMap;
  categories: IdMap;
  arenas: IdMap;
  spaces: IdMap;
  slots: IdMap;
  reservations: IdMap;
  recurrences: IdMap;
  occurrences: IdMap;
  events: IdMap;
  bookings: IdMap;
  payments: IdMap;
};

const ctx: SeedContext = {
  users: {},
  categories: {},
  arenas: {},
  spaces: {},
  slots: {},
  reservations: {},
  recurrences: {},
  occurrences: {},
  events: {},
  bookings: {},
  payments: {}
};

function addDays(days: number, hour = 10, minute = 0): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function endFrom(start: Date, hours = 2): Date {
  return new Date(start.getTime() + hours * 60 * 60 * 1000);
}

function iso(date: Date): string {
  return date.toISOString();
}

function dueAt(slotStart: Date): string {
  return iso(new Date(slotStart.getTime() - 24 * 60 * 60 * 1000));
}

/** Slot com duração customizada (padrão 1h). */
function slotWindow(days: number, hour: number, minute = 0, durationHours = 1): { start: Date; end: Date } {
  const start = addDays(days, hour, minute);
  return { start, end: endFrom(start, durationHours) };
}

async function insertReturningId(client: PoolClient, sql: string, params: unknown[]): Promise<string> {
  const res = await client.query<{ id: string }>(sql, params);
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error("Seed insert did not return id");
  }
  return id;
}

async function resetDevData(client: PoolClient) {
  await client.query(`
    TRUNCATE TABLE
      idempotency_keys,
      audit_logs,
      notifications,
      payments,
      reservation_occurrences,
      reservation_recurrences,
      event_participants,
      bookings,
      events,
      reservations,
      arena_slots,
      arena_spaces,
      arena_policies,
      arena_addresses,
      arenas,
      event_categories,
      user_profiles,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function seedUsers(client: PoolClient) {
  const passwordHash = await bcrypt.hash(PASSWORD, HASH_ROUNDS);
  const users = [
    ["admin", "Admin Spolê", "admin@spole.dev", "admin", "ACTIVE", "91900000001"],
    ["arena1", "Dono Arena 1", "arena1@spole.dev", "arena_owner", "ACTIVE", "91900000002"],
    ["arena2", "Dono Arena 2", "arena2@spole.dev", "arena_owner", "ACTIVE", "91900000003"],
    ["org1", "Organizador 1", "org1@spole.dev", "user", "ACTIVE", "91900000004"],
    ["org2", "Organizador 2", "org2@spole.dev", "user", "ACTIVE", "91900000005"],
    ["org3", "Organizador Funcional", "org3@spole.dev", "user", "ACTIVE", "91900000006"],
    ["user1", "Usuário Ana", "user1@spole.dev", "user", "ACTIVE", "91900000011"],
    ["user2", "Usuário Bruno", "user2@spole.dev", "user", "ACTIVE", "91900000012"],
    ["user3", "Usuário Carla", "user3@spole.dev", "user", "ACTIVE", "91900000013"],
    ["user4", "Usuário Diego", "user4@spole.dev", "user", "ACTIVE", "91900000014"],
    ["user5", "Usuário Eva", "user5@spole.dev", "user", "ACTIVE", "91900000015"],
    ["user6", "Usuário Felipe", "user6@spole.dev", "user", "ACTIVE", "91900000016"],
    ["suspended", "Usuário Suspenso", "suspended@spole.dev", "user", "SUSPENDED", "91900000017"],
    ["inactive", "Usuário Inativo", "inactive@spole.dev", "user", "INACTIVE", "91900000018"]
  ] as const;

  for (const [key, name, email, role, status, phone] of users) {
    ctx.users[key] = await insertReturningId(
      client,
      `
        INSERT INTO users (name, email, password_hash, phone, role, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [name, email, passwordHash, phone, role, status]
    );
    await client.query(`INSERT INTO user_profiles (user_id) VALUES ($1)`, [ctx.users[key]]);
  }
}

async function seedCategories(client: PoolClient) {
  const categories = [
    ["futebol", "Futebol", "futebol", "ball", "ACTIVE"],
    ["volei", "Vôlei", "volei", "net", "ACTIVE"],
    ["beachTennis", "Beach Tennis", "beach-tennis", "beach", "ACTIVE"],
    ["corrida", "Corrida", "corrida", "run", "ACTIVE"],
    ["ciclismo", "Ciclismo", "ciclismo", "bike", "ACTIVE"],
    ["funcional", "Funcional", "funcional", "fitness", "ACTIVE"],
    ["personal", "Personal Trainer", "personal-trainer", "trainer", "ACTIVE"],
    ["basquete", "Basquete", "basquete", "basket", "INACTIVE"]
  ] as const;

  for (const [key, name, slug, icon, status] of categories) {
    ctx.categories[key] = await insertReturningId(
      client,
      `
        INSERT INTO event_categories (name, slug, icon, status)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [name, slug, icon, status]
    );
  }
}

async function seedArenas(client: PoolClient) {
  /** Catálogo público GET /arenas — 5 ACTIVE + 1 INACTIVE (não listada). */
  const arenas = [
    {
      key: "central",
      ownerKey: "arena1",
      name: "Arena Spolê Central",
      slug: "arena-spole-central",
      description: "Arena principal para homologação H-19: reserva paga, slots futuros e evento em arena.",
      phone: "9133010001",
      email: "central@spole.dev",
      document: "11111111000191",
      status: "ACTIVE",
      address: ["66050-000", "Travessa Doutor Moraes", "120", "Umarizal", "Belém", "PA", -1.4558, -48.4812],
      policy: [true, 0, 100]
    },
    {
      key: "norte",
      ownerKey: "arena1",
      name: "Arena Spolê Norte",
      slug: "arena-spole-norte",
      description: "Arena com pagamento mínimo 0% — reserva confirma sem cobrança Pix.",
      phone: "9133010002",
      email: "norte@spole.dev",
      document: "11111111000192",
      status: "ACTIVE",
      address: ["66035-110", "Rua dos Mundurucus", "450", "Batista Campos", "Belém", "PA", -1.448, -48.478],
      policy: [true, 0, 0]
    },
    {
      key: "beach",
      ownerKey: "arena1",
      name: "Arena Beach Spolê",
      slug: "arena-beach-spole",
      description: "Beach tennis e vôlei de praia — testes de paginação e filtro por bairro.",
      phone: "9133010003",
      email: "beach@spole.dev",
      document: "11111111000193",
      status: "ACTIVE",
      address: ["66920-000", "Avenida Beira Mar", "80", "Mosqueiro", "Belém", "PA", -1.172, -48.483],
      policy: [true, 0, 100]
    },
    {
      key: "voleiPara",
      ownerKey: "arena2",
      name: "Arena Vôlei Pará",
      slug: "arena-volei-para",
      description: "Arena em Ananindeua para filtro por cidade.",
      phone: "9133020001",
      email: "volei@spole.dev",
      document: "22222222000191",
      status: "ACTIVE",
      address: ["67030-000", "Avenida Independência", "900", "Centro", "Ananindeua", "PA", -1.3656, -48.3722],
      policy: [false, 0, 100]
    },
    {
      key: "funcionalRibeira",
      ownerKey: "arena2",
      name: "Arena Funcional Ribeirinha",
      slug: "arena-funcional-ribeirinha",
      description: "Treinos funcionais em Icoaraci — busca por nome e bairro.",
      phone: "9133020002",
      email: "funcional@spole.dev",
      document: "22222222000192",
      status: "ACTIVE",
      address: ["66813-100", "Passagem São João", "25", "Icoaraci", "Belém", "PA", -1.298, -48.51],
      policy: [true, 0, 50]
    },
    {
      key: "inativa",
      ownerKey: "arena1",
      name: "Arena Spolê Inativa Homologação",
      slug: "arena-spole-inativa",
      description: "Não aparece em GET /arenas público; visível para owner e admin.",
      phone: "9133010099",
      email: "inativa@spole.dev",
      document: "11111111000199",
      status: "INACTIVE",
      address: ["66055-000", "Rua Inativa", "1", "Nazaré", "Belém", "PA", -1.46, -48.49],
      policy: [false, 4, 100]
    }
  ] as const;

  for (const arena of arenas) {
    ctx.arenas[arena.key] = await insertReturningId(
      client,
      `
        INSERT INTO arenas (owner_id, name, slug, description, phone, email, document, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        ctx.users[arena.ownerKey],
        arena.name,
        arena.slug,
        arena.description,
        arena.phone,
        arena.email,
        arena.document,
        arena.status
      ]
    );

    await client.query(
      `
        INSERT INTO arena_addresses (
          arena_id, zip_code, street, number, district, city, state, latitude, longitude
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [ctx.arenas[arena.key], ...arena.address]
    );

    await client.query(
      `
        INSERT INTO arena_policies (
          arena_id, allow_recurring, min_advance_hours, min_reservation_payment_percent
        )
        VALUES ($1, $2, $3, $4)
      `,
      [ctx.arenas[arena.key], ...arena.policy]
    );
  }
}

async function seedSpaces(client: PoolClient) {
  const spaces = [
    ["centralSociety1", "central", "Campo Society 1", "COURT", "Society gramado — principal para H-19 reserva paga.", 22, "ACTIVE"],
    ["centralSociety2", "central", "Campo Society 2", "COURT", "Society secundário.", 22, "ACTIVE"],
    ["centralVolei", "central", "Quadra Vôlei", "COURT", "Quadra de vôlei coberta.", 12, "ACTIVE"],
    ["nortePoli", "norte", "Quadra Poliesportiva", "COURT", "Poliesportiva — auto-confirma (0%).", 18, "ACTIVE"],
    ["norteSociety", "norte", "Campo Society", "COURT", "Society na arena norte.", 20, "ACTIVE"],
    ["voleiQ1", "voleiPara", "Quadra Vôlei 1", "COURT", "Quadra 1 Ananindeua.", 12, "ACTIVE"],
    ["voleiQ2", "voleiPara", "Quadra Vôlei 2", "COURT", "Quadra 2 Ananindeua.", 12, "ACTIVE"],
    ["funcionalArea", "funcionalRibeira", "Espaço Funcional", "FUNCTIONAL", "Área funcional Icoaraci.", 16, "ACTIVE"],
    ["beachCourt", "beach", "Quadra Beach", "BEACH_TENNIS", "Beach tennis Mosqueiro.", 8, "ACTIVE"],
    ["inativaQuadra", "inativa", "Quadra Inativa", "COURT", "Espaço em arena inativa.", 18, "ACTIVE"]
  ] as const;

  for (const [key, arenaKey, name, type, description, capacity, status] of spaces) {
    ctx.spaces[key] = await insertReturningId(
      client,
      `
        INSERT INTO arena_spaces (arena_id, name, type, description, capacity_suggestion, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [ctx.arenas[arenaKey], name, type, description, capacity, status]
    );
  }
}

async function createSlot(
  client: PoolClient,
  key: string,
  spaceKey: string,
  start: Date,
  price: number,
  status: string,
  allowsRecurring: boolean,
  notes: string
) {
  ctx.slots[key] = await insertReturningId(
    client,
    `
      INSERT INTO arena_slots (space_id, start_at, end_at, price, status, allows_recurring, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [ctx.spaces[spaceKey], iso(start), iso(endFrom(start)), price, status, allowsRecurring, notes]
  );
}

async function seedSlots(client: PoolClient) {
  /** Grade de slots futuros (7–14 dias) para catálogo e reservas. */
  const grid: Array<{
    key: string;
    spaceKey: string;
    days: number;
    hour: number;
    price: number;
    status: string;
    recurring: boolean;
    notes: string;
  }> = [];

  const addGrid = (
    spaceKey: string,
    prefix: string,
    price: number,
    recurring: boolean,
    dayOffsets: number[],
    hours: number[]
  ) => {
    for (const day of dayOffsets) {
      for (const hour of hours) {
        grid.push({
          key: `${prefix}_d${day}h${hour}`,
          spaceKey,
          days: day,
          hour,
          price,
          status: "AVAILABLE",
          recurring,
          notes: `Disponível — ${prefix} +${day}d ${hour}h`
        });
      }
    }
  };

  addGrid("centralSociety1", "centralS1", 120, true, [1, 2, 5, 7, 10, 12], [8, 14, 19]);
  addGrid("centralSociety2", "centralS2", 100, false, [2, 4, 8], [10, 18]);
  addGrid("centralVolei", "centralV", 80, false, [3, 6], [9, 17]);
  addGrid("nortePoli", "norteP", 90, false, [1, 3, 6, 9], [8, 15, 20]);
  addGrid("norteSociety", "norteS", 110, false, [2, 5, 11], [19, 20]);
  addGrid("voleiQ1", "volei1", 70, false, [1, 4, 7, 13], [8, 14, 19]);
  addGrid("voleiQ2", "volei2", 70, false, [2, 6, 10], [10, 18]);
  addGrid("funcionalArea", "funcR", 60, true, [1, 3, 8, 14], [7, 12, 18]);
  addGrid("beachCourt", "beach", 95, false, [2, 5, 9, 12], [8, 17, 20]);

  for (const row of grid) {
    const { start } = slotWindow(row.days, row.hour);
    await createSlot(client, row.key, row.spaceKey, start, row.price, row.status, row.recurring, row.notes);
  }

  /** H-19: slot livre amanhã à noite na Central (reserva + Pix real pelo frontend). */
  const h19Start = slotWindow(1, 20).start;
  await createSlot(
    client,
    "h19CentralPaid",
    "centralSociety1",
    h19Start,
    120,
    "AVAILABLE",
    false,
    "H-19 — criar reserva e pagamento Pix real (não pré-preencher payment)."
  );

  /** Reserva pendente (HOLD) — org1; frontend pode pagar ou criar novo fluxo em outro slot. */
  const pendingStart = slotWindow(2, 19).start;
  await createSlot(
    client,
    "holdOrg1Pending",
    "centralSociety1",
    pendingStart,
    120,
    "HOLD",
    false,
    "Reserva PENDING seed — aguardando pagamento (mock dev opcional)."
  );

  /** Reserva confirmada sem pagamento — org2 na Norte (0%). */
  const norteConfirmedStart = slotWindow(3, 18).start;
  await createSlot(
    client,
    "norteConfirmed",
    "nortePoli",
    norteConfirmedStart,
    90,
    "RESERVED",
    false,
    "Reserva CONFIRMED auto (min payment 0%)."
  );

  /** Reserva cancelada. */
  const cancelledStart = slotWindow(4, 16).start;
  await createSlot(
    client,
    "slotCancelled",
    "norteSociety",
    cancelledStart,
    110,
    "CANCELLED",
    false,
    "Slot cancelado — indisponível."
  );

  /** Recorrência semanal (parent + ocorrências). */
  const recurStart = slotWindow(6, 19).start;
  await createSlot(
    client,
    "recurParent",
    "centralSociety1",
    recurStart,
    120,
    "RESERVED",
    true,
    "Reserva recorrente confirmada — gera ocorrências."
  );
  await createSlot(client, "occPending", "centralSociety1", slotWindow(13, 19).start, 120, "HOLD", true, "Ocorrência PENDING_PAYMENT.");
  await createSlot(client, "occConfirmed", "centralSociety1", slotWindow(20, 19).start, 120, "RESERVED", true, "Ocorrência CONFIRMED.");
  await createSlot(client, "occReleased", "centralSociety1", slotWindow(-1, 19).start, 120, "AVAILABLE", true, "Ocorrência RELEASED.");
  await createSlot(client, "occCancelled", "centralSociety1", slotWindow(27, 19).start, 120, "CANCELLED", true, "Ocorrência CANCELLED.");

  /** Evento ARENA_RESERVATION — reserva confirmada na Central. */
  const eventArenaStart = slotWindow(10, 8).start;
  await createSlot(
    client,
    "eventArenaCentral",
    "centralVolei",
    eventArenaStart,
    80,
    "RESERVED",
    false,
    "Reserva vinculada ao evento Partida na Arena Spolê Central."
  );

  /** Slot em arena inativa (não no catálogo público). */
  await createSlot(client, "inactiveSlot", "inativaQuadra", slotWindow(7, 9).start, 90, "AVAILABLE", false, "Slot em arena INACTIVE.");
}

async function createReservation(
  client: PoolClient,
  key: string,
  slotKey: string,
  organizerKey: string,
  type: string,
  status: string,
  totalPrice: number,
  requiredPaymentAmount: number,
  paidAmount: number,
  expiresAt: Date | null,
  confirmedAt: Date | null
) {
  ctx.reservations[key] = await insertReturningId(
    client,
    `
      INSERT INTO reservations (
        slot_id, organizer_id, type, status, total_price, required_payment_amount,
        paid_amount, expires_at, confirmed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      ctx.slots[slotKey],
      ctx.users[organizerKey],
      type,
      status,
      totalPrice,
      requiredPaymentAmount,
      paidAmount,
      expiresAt ? iso(expiresAt) : null,
      confirmedAt ? iso(confirmedAt) : null
    ]
  );
}

async function seedReservations(client: PoolClient) {
  await createReservation(client, "pending", "holdOrg1Pending", "org1", "SINGLE", "PENDING", 120, 120, 0, addDays(1, 23), null);
  await createReservation(client, "norteConfirmed", "norteConfirmed", "org2", "SINGLE", "CONFIRMED", 90, 0, 0, null, addDays(-1, 10));
  await createReservation(client, "cancelled", "slotCancelled", "org1", "SINGLE", "CANCELLED", 110, 55, 0, null, null);
  await createReservation(client, "recurringConfirmed", "recurParent", "org1", "RECURRING", "CONFIRMED", 120, 120, 120, null, addDays(-1, 11));
  await createReservation(client, "eventArenaCentral", "eventArenaCentral", "org1", "SINGLE", "CONFIRMED", 80, 80, 80, null, addDays(-1, 12));
}

async function seedReservationRecurrences(client: PoolClient) {
  const parentSlotStart = addDays(6, 19);
  ctx.recurrences.weeklyCentral = await insertReturningId(
    client,
    `
      INSERT INTO reservation_recurrences (reservation_id, frequency, day_of_week, active)
      VALUES ($1, 'WEEKLY', $2, true)
      RETURNING id
    `,
    [ctx.reservations.recurringConfirmed, parentSlotStart.getUTCDay()]
  );
}

async function createOccurrence(
  client: PoolClient,
  key: string,
  slotKey: string,
  status: string,
  paidAt: Date | null,
  releasedAt: Date | null
) {
  const start = {
    occPending: addDays(13, 19),
    occConfirmed: addDays(20, 19),
    occReleased: addDays(-1, 19),
    occCancelled: addDays(27, 19)
  }[key];
  if (!start) {
    throw new Error(`Unknown occurrence key: ${key}`);
  }

  ctx.occurrences[key] = await insertReturningId(
    client,
    `
      INSERT INTO reservation_occurrences (
        recurrence_id, slot_id, status, due_at, paid_at, released_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      ctx.recurrences.weeklyCentral,
      ctx.slots[slotKey],
      status,
      dueAt(start),
      paidAt ? iso(paidAt) : null,
      releasedAt ? iso(releasedAt) : null
    ]
  );
}

async function seedReservationOccurrences(client: PoolClient) {
  await createOccurrence(client, "occPending", "occPending", "PENDING_PAYMENT", null, null);
  await createOccurrence(client, "occConfirmed", "occConfirmed", "CONFIRMED", addDays(-1, 10), null);
  await createOccurrence(client, "occReleased", "occReleased", "RELEASED", null, addDays(0, 8));
  await createOccurrence(client, "occCancelled", "occCancelled", "CANCELLED", null, null);
}

async function createEvent(
  client: PoolClient,
  key: string,
  params: {
    organizerKey: string;
    categoryKey: string;
    title: string;
    description: string;
    type: "FREE" | "PAID";
    visibility: "PUBLIC" | "PRIVATE";
    status: "DRAFT" | "PUBLISHED" | "CANCELLED";
    start: Date;
    addressName: string;
    city: string;
    capacity: number;
    price?: number;
    privateCode?: string | null;
    reservationKey?: string | null;
  }
) {
  const sourceType = params.reservationKey ? "ARENA_RESERVATION" : "FREE_LOCATION";
  ctx.events[key] = await insertReturningId(
    client,
    `
      INSERT INTO events (
        organizer_id, category_id, title, description, type, visibility, source_type, status,
        start_at, end_at, address_name, street, number, district, city, state, capacity,
        price_per_person, private_code, reservation_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id
    `,
    [
      ctx.users[params.organizerKey],
      ctx.categories[params.categoryKey],
      params.title,
      params.description,
      params.type,
      params.visibility,
      sourceType,
      params.status,
      iso(params.start),
      iso(endFrom(params.start)),
      params.addressName,
      "Rua dos Eventos",
      "500",
      "Centro",
      params.city,
      "PA",
      params.capacity,
      params.type === "PAID" ? params.price ?? 30 : null,
      params.visibility === "PRIVATE" ? params.privateCode ?? "PRIVATE123" : null,
      params.reservationKey ? ctx.reservations[params.reservationKey] : null
    ]
  );
}

async function seedEvents(client: PoolClient) {
  /** org1 — painel GET /users/me/events e homologação H-19 */
  await createEvent(client, "futebolAberto", {
    organizerKey: "org1",
    categoryKey: "futebol",
    title: "Futebol Aberto Spolê",
    description: "Evento público gratuito — busca por futebol e catálogo.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(5, 18),
    addressName: "Campo Society Umarizal",
    city: "Belém",
    capacity: 20
  });
  await createEvent(client, "torneioPago", {
    organizerKey: "org1",
    categoryKey: "futebol",
    title: "Torneio Spolê Pago",
    description:
      "Principal evento H-19: criar booking + pagamento Pix real pelo frontend (sem payment pré-criado no seed).",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(12, 19),
    addressName: "Arena Society Central",
    city: "Belém",
    capacity: 20,
    price: 40
  });
  await createEvent(client, "treinoPrivado", {
    organizerKey: "org1",
    categoryKey: "corrida",
    title: "Treino Privado Spolê",
    description: "Evento privado — privateCode só no GET /events/:id para dono/admin.",
    type: "FREE",
    visibility: "PRIVATE",
    status: "PUBLISHED",
    start: addDays(8, 7),
    addressName: "Pista Privada",
    city: "Belém",
    capacity: 12,
    privateCode: "TREINO-PRIV-SPOLE"
  });
  await createEvent(client, "rascunho", {
    organizerKey: "org1",
    categoryKey: "futebol",
    title: "Evento Rascunho Spolê",
    description: "DRAFT — visível em /users/me/events; fora do catálogo público.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "DRAFT",
    start: addDays(20, 19),
    addressName: "Campo Rascunho",
    city: "Belém",
    capacity: 16,
    price: 25
  });
  await createEvent(client, "cancelado", {
    organizerKey: "org1",
    categoryKey: "volei",
    title: "Evento Cancelado Spolê",
    description: "CANCELLED — listagem do organizador; indisponível publicamente.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "CANCELLED",
    start: addDays(15, 18),
    addressName: "Quadra Cancelada",
    city: "Belém",
    capacity: 18
  });
  await createEvent(client, "partidaArena", {
    organizerKey: "org1",
    categoryKey: "futebol",
    title: "Partida na Arena Spolê Central",
    description: "ARENA_RESERVATION — locationReadOnly no detalhe para organizador.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(10, 8),
    addressName: "Arena Spolê Central",
    city: "Belém",
    capacity: 16,
    reservationKey: "eventArenaCentral"
  });

  /** org2 — ownership e 403 */
  await createEvent(client, "org2Pago", {
    organizerKey: "org2",
    categoryKey: "beachTennis",
    title: "Torneio Beach Org2",
    description: "Evento pago do org2 — org1 não acessa operações.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(9, 18),
    addressName: "Arena Beach",
    city: "Belém",
    capacity: 12,
    price: 35
  });
  await createEvent(client, "org2Gratuito", {
    organizerKey: "org2",
    categoryKey: "funcional",
    title: "Funcional Aberto Org2",
    description: "Evento gratuito do org2.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(6, 8),
    addressName: "Parque Funcional",
    city: "Ananindeua",
    capacity: 25
  });

  /** Diversidade para busca pública e capacidade */
  await createEvent(client, "corridaPublica", {
    organizerKey: "org1",
    categoryKey: "corrida",
    title: "Corrida Leve Spolê",
    description: "Corrida pública para filtros q/cidade.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(4, 6),
    addressName: "Doca Boulevard",
    city: "Belém",
    capacity: 30
  });
  await createEvent(client, "voleiQuaseLotado", {
    organizerKey: "org3",
    categoryKey: "volei",
    title: "Vôlei Quase Lotado",
    description: "Poucas vagas — teste de capacidade.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(7, 17),
    addressName: "Quadra Vôlei",
    city: "Belém",
    capacity: 4
  });
  await createEvent(client, "pagoLotado", {
    organizerKey: "org2",
    categoryKey: "beachTennis",
    title: "Beach Pago Lotado Seed",
    description: "Pago lotado — bookings mock PAID no seed.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(14, 18),
    addressName: "Praia",
    city: "Belém",
    capacity: 2,
    price: 50
  });
  await createEvent(client, "pagoExpirado", {
    organizerKey: "org2",
    categoryKey: "personal",
    title: "Evento Pago Booking Expirado",
    description: "Regressão — booking EXPIRED + payment FAILED mock.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(11, 9),
    addressName: "Studio",
    city: "Belém",
    capacity: 10,
    price: 30
  });
}

async function seedEventParticipants(client: PoolClient) {
  const participants = [
    ["futebolAberto", "user1"],
    ["voleiQuaseLotado", "user1"],
    ["voleiQuaseLotado", "user2"],
    ["voleiQuaseLotado", "user3"],
    ["torneioPago", "user2"],
    ["pagoLotado", "user5"],
    ["pagoLotado", "user6"],
    ["partidaArena", "user2"]
  ] as const;

  for (const [eventKey, userKey] of participants) {
    await client.query(
      `
        INSERT INTO event_participants (event_id, user_id, status)
        VALUES ($1, $2, 'CONFIRMED')
      `,
      [ctx.events[eventKey], ctx.users[userKey]]
    );
  }
}

async function createBooking(
  client: PoolClient,
  key: string,
  eventKey: string,
  userKey: string,
  status: string,
  reservedAt: Date,
  expiresAt: Date,
  purchaseCompletedAt: Date | null
) {
  ctx.bookings[key] = await insertReturningId(
    client,
    `
      INSERT INTO bookings (
        event_id, user_id, status, reserved_at, expires_at, redis_key, purchase_completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [
      ctx.events[eventKey],
      ctx.users[userKey],
      status,
      iso(reservedAt),
      iso(expiresAt),
      `booking:seed:${key}`,
      purchaseCompletedAt ? iso(purchaseCompletedAt) : null
    ]
  );
}

async function seedBookings(client: PoolClient) {
  /** Torneio Spolê Pago: user2 já confirmado (mock) — user1 livre para H-19 criar booking novo. */
  await createBooking(client, "torneioCompleted", "torneioPago", "user2", "COMPLETED", addDays(-1, 9), addDays(2, 9), addDays(-1, 10));
  await createBooking(client, "torneioExpired", "torneioPago", "user5", "EXPIRED", addDays(-2, 9), addDays(-1, 9), null);
  await createBooking(client, "pagoLotadoU5", "pagoLotado", "user5", "COMPLETED", addDays(-1, 12), addDays(1, 12), addDays(-1, 13));
  await createBooking(client, "pagoLotadoU6", "pagoLotado", "user6", "COMPLETED", addDays(-1, 14), addDays(1, 14), addDays(-1, 15));
  await createBooking(client, "pagoExpiradoBk", "pagoExpirado", "user4", "EXPIRED", addDays(-2, 8), addDays(-1, 8), null);
}

async function createPayment(
  client: PoolClient,
  key: string,
  userKey: string,
  context: { bookingKey?: string; reservationKey?: string; occurrenceKey?: string },
  status: string,
  amount: number,
  paidAt: Date | null
) {
  ctx.payments[key] = await insertReturningId(
    client,
    `
      INSERT INTO payments (
        user_id, booking_id, reservation_id, reservation_occurrence_id,
        method, provider, provider_reference, gross_amount, fee_amount, net_amount,
        status, paid_at
      )
      VALUES ($1, $2, $3, $4, 'PIX', 'mock-provider', $5, $6, 0, $6, $7, $8)
      RETURNING id
    `,
    [
      ctx.users[userKey],
      context.bookingKey ? ctx.bookings[context.bookingKey] : null,
      context.reservationKey ? ctx.reservations[context.reservationKey] : null,
      context.occurrenceKey ? ctx.occurrences[context.occurrenceKey] : null,
      `seed-dev-mock-${key}`,
      amount,
      status,
      paidAt ? iso(paidAt) : null
    ]
  );
}

async function seedPayments(client: PoolClient) {
  /**
   * Pagamentos **mock/dev** apenas — provider_reference prefixado `seed-dev-mock-*`.
   * Não são cobranças Asaas. Fluxo H-19 Pix real: criar payment pelo frontend.
   */
  await createPayment(client, "torneioPaid", "user2", { bookingKey: "torneioCompleted" }, "PAID", 40, addDays(-1, 10));
  await createPayment(client, "torneioFailed", "user5", { bookingKey: "torneioExpired" }, "FAILED", 40, null);
  await createPayment(client, "lotadoU5", "user5", { bookingKey: "pagoLotadoU5" }, "PAID", 50, addDays(-1, 13));
  await createPayment(client, "lotadoU6", "user6", { bookingKey: "pagoLotadoU6" }, "PAID", 50, addDays(-1, 15));
  await createPayment(client, "expiradoFailed", "user4", { bookingKey: "pagoExpiradoBk" }, "FAILED", 30, null);
  await createPayment(client, "reservationPending", "org1", { reservationKey: "pending" }, "PENDING", 120, null);
  await createPayment(client, "reservationPaidRecur", "org1", { reservationKey: "recurringConfirmed" }, "PAID", 120, addDays(-1, 10));
  await createPayment(client, "occurrencePaid", "org1", { occurrenceKey: "occConfirmed" }, "PAID", 120, addDays(-1, 10));
  await createPayment(client, "occurrenceFailed", "org1", { occurrenceKey: "occReleased" }, "FAILED", 120, null);
  await createPayment(client, "reservationCancelled", "org1", { reservationKey: "cancelled" }, "CANCELLED", 55, null);
}

async function seedNotifications(client: PoolClient) {
  const notifications = [
    ["user2", "Pagamento confirmado", "Sua vaga no Torneio Spolê Pago foi confirmada (seed mock).", "PAYMENT_CONFIRMED", null],
    ["user5", "Pagamento confirmado", "Pagamento mock em evento lotado.", "PAYMENT_CONFIRMED", addDays(0, 8)],
    ["org1", "Pagamento da reserva confirmado", "Reserva recorrente confirmada (seed mock).", "PAYMENT_CONFIRMED", addDays(0, 9)]
  ] as const;

  for (const [userKey, title, message, type, readAt] of notifications) {
    await client.query(
      `
        INSERT INTO notifications (user_id, title, message, type, read_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [ctx.users[userKey], title, message, type, readAt ? iso(readAt) : null]
    );
  }
}

async function seedAuditLogs(client: PoolClient) {
  const logs = [
    [
      "USER_STATUS_CHANGED",
      "USER",
      ctx.users.suspended,
      "Usuário suspenso para teste de bloqueio de login.",
      { previousStatus: "ACTIVE", nextStatus: "SUSPENDED", seed: true }
    ],
    [
      "ARENA_STATUS_CHANGED",
      "ARENA",
      ctx.arenas.inativa,
      "Arena marcada como inativa para homologação.",
      { previousStatus: "ACTIVE", nextStatus: "INACTIVE", seed: true }
    ],
    [
      "EVENT_CANCELLED",
      "EVENT",
      ctx.events.cancelado,
      "Cancelamento administrativo de evento seed.",
      { status: "CANCELLED", seed: true }
    ]
  ] as const;

  for (const [action, resourceType, resourceId, reason, metadata] of logs) {
    await client.query(
      `
        INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [ctx.users.admin, action, resourceType, resourceId, reason, JSON.stringify(metadata)]
    );
  }
}

async function runSeed() {
  if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error("Refusing to run development seed with NODE_ENV=production");
  }

  ensureProcessEnvForApiLoadEnv();
  const env = loadEnv();
  const pool = createPostgresPool(env.postgres);
  const logger = createLogger("seed-dev");

  try {
    await runMigrations(pool, logger);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await resetDevData(client);
      await seedUsers(client);
      await seedCategories(client);
      await seedArenas(client);
      await seedSpaces(client);
      await seedSlots(client);
      await seedReservations(client);
      await seedReservationRecurrences(client);
      await seedReservationOccurrences(client);
      await seedEvents(client);
      await seedEventParticipants(client);
      await seedBookings(client);
      await seedPayments(client);
      await seedNotifications(client);
      await seedAuditLogs(client);

      await client.query("COMMIT");

      const redis = createRedisClient(env.redis);
      try {
        await redis.connect();
        await bumpPublicCatalogVersion(redis);
        console.log(
          "[seed-dev] Cache público invalidado (Redis: versão do catálogo incrementada; GET /events e GET /categories passam a refletir o seed)."
        );
      } catch (redisErr) {
        console.warn(
          "[seed-dev] Não foi possível invalidar o cache no Redis. Se GET /events já tinha sido chamado antes do seed, a API pode devolver lista vazia até expirar PUBLIC_READ_CACHE_TTL_SECONDS.",
          redisErr instanceof Error ? redisErr.message : redisErr
        );
      } finally {
        try {
          await redis.quit();
        } catch {
          /* ignore */
        }
      }

      console.log("[seed-dev] Massa de desenvolvimento criada com sucesso.");
      console.log(`[seed-dev] Senha padrão: ${PASSWORD}`);
      console.log("[seed-dev] H-19 — evento pago Pix real: Torneio Spolê Pago (org1) + login user1@spole.dev");
      console.log("[seed-dev] H-19 — reserva arena paga: Arena Spolê Central, slot h19CentralPaid (+1d 20h), org1@spole.dev");
      console.log("[seed-dev] GET /arenas: 5 arenas ACTIVE (Belém/Ananindeua); filtro city=Ananindeua → Arena Vôlei Pará");
      console.log("[seed-dev] Pagamentos no seed são mock (seed-dev-mock-*). Pix real só via fluxo do frontend.");
      console.log("[seed-dev] Documentação: docs/02-dev-seed.md e docs/homologation-h19-api.md");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

runSeed().catch((err) => {
  console.error("[seed-dev] Falha ao criar massa de desenvolvimento:", err);
  process.exit(1);
});
