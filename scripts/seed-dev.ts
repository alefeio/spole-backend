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
    ["arena1", "Arena Owner Norte", "arena1@spole.dev", "arena_owner", "ACTIVE", "91900000002"],
    ["arena2", "Arena Owner Sul", "arena2@spole.dev", "arena_owner", "ACTIVE", "91900000003"],
    ["org1", "Organizador Corrida", "org1@spole.dev", "user", "ACTIVE", "91900000004"],
    ["org2", "Organizadora Beach", "org2@spole.dev", "user", "ACTIVE", "91900000005"],
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
  const arenas = [
    {
      key: "arenaNorte",
      ownerKey: "arena1",
      name: "Arena Norte Recorrência",
      slug: "arena-norte-recorrencia",
      description: "Arena ativa para testar reservas recorrentes e pagamento mínimo.",
      phone: "9133001001",
      email: "norte@spole.dev",
      document: "11111111000191",
      status: "ACTIVE",
      address: ["66000001", "Avenida Esporte Norte", "100", "Nazaré", "Belém", "PA", -1.455, -48.49],
      policy: [true, 2, 30]
    },
    {
      key: "arenaZero",
      ownerKey: "arena2",
      name: "Arena Sul Auto Confirma",
      slug: "arena-sul-auto-confirma",
      description: "Arena ativa com pagamento mínimo zero para auto-confirmação.",
      phone: "9133001002",
      email: "sul@spole.dev",
      document: "22222222000192",
      status: "ACTIVE",
      address: ["66000002", "Travessa Auto Confirma", "200", "Marco", "Belém", "PA", -1.43, -48.46],
      policy: [false, 1, 0]
    },
    {
      key: "arenaInativa",
      ownerKey: "arena2",
      name: "Arena Inativa Operacional",
      slug: "arena-inativa-operacional",
      description: "Arena inativa para testes administrativos e operacionais.",
      phone: "9133001003",
      email: "inativa@spole.dev",
      document: "33333333000193",
      status: "INACTIVE",
      address: ["66000003", "Rua Pausada", "300", "Umarizal", "Belém", "PA", -1.44, -48.48],
      policy: [false, 4, 50]
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
    ["norteQuadra1", "arenaNorte", "Quadra 1 Recorrente", "COURT", "Quadra principal com recorrência.", 22, "ACTIVE"],
    ["norteQuadra2", "arenaNorte", "Quadra 2", "COURT", "Quadra para eventos avulsos.", 18, "ACTIVE"],
    ["norteFuncional", "arenaNorte", "Espaço Funcional", "FUNCTIONAL", "Área coberta para treinos.", 16, "ACTIVE"],
    ["zeroQuadra1", "arenaZero", "Quadra Auto Confirma", "COURT", "Quadra com política de pagamento 0%.", 20, "ACTIVE"],
    ["zeroBeach", "arenaZero", "Beach Tennis Sul", "BEACH_TENNIS", "Quadra de areia.", 8, "ACTIVE"],
    ["zeroFuncional", "arenaZero", "Espaço Livre Sul", "FUNCTIONAL", "Área multiuso.", 15, "ACTIVE"],
    ["inativaQuadra1", "arenaInativa", "Quadra Inativa 1", "COURT", "Espaço de arena inativa.", 18, "ACTIVE"],
    ["inativaQuadra2", "arenaInativa", "Quadra Inativa 2", "COURT", "Espaço bloqueado para operação.", 18, "BLOCKED"]
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
  await createSlot(client, "availableNorte", "norteQuadra2", addDays(3, 10), 180, "AVAILABLE", false, "Slot disponível para teste manual.");
  await createSlot(client, "holdPending", "norteQuadra1", addDays(4, 19), 200, "HOLD", true, "Reserva pendente aguardando pagamento.");
  await createSlot(client, "reservedRecurringParent", "norteQuadra1", addDays(6, 19), 200, "RESERVED", true, "Reserva recorrente confirmada.");
  await createSlot(client, "cancelledSlot", "norteQuadra2", addDays(8, 16), 150, "CANCELLED", false, "Slot cancelado para operação.");
  await createSlot(client, "autoConfirmedZero", "zeroQuadra1", addDays(5, 20), 120, "RESERVED", false, "Reserva auto-confirmada por pagamento mínimo 0%.");
  await createSlot(client, "consumedZero", "zeroQuadra1", addDays(-2, 20), 120, "RESERVED", false, "Reserva consumida no passado.");
  await createSlot(client, "eventArenaNorte", "norteFuncional", addDays(10, 8), 160, "RESERVED", false, "Reserva usada por evento em arena.");
  await createSlot(client, "eventArenaZero", "zeroBeach", addDays(12, 18), 100, "RESERVED", false, "Reserva usada por evento beach.");
  await createSlot(client, "occPending", "norteQuadra1", addDays(13, 19), 200, "HOLD", true, "Ocorrência futura pendente de pagamento.");
  await createSlot(client, "occConfirmed", "norteQuadra1", addDays(20, 19), 200, "RESERVED", true, "Ocorrência futura confirmada.");
  await createSlot(client, "occReleased", "norteQuadra1", addDays(-1, 19), 200, "AVAILABLE", true, "Ocorrência liberada por inadimplência.");
  await createSlot(client, "occCancelled", "norteQuadra1", addDays(27, 19), 200, "CANCELLED", true, "Ocorrência cancelada.");
  await createSlot(client, "inactiveAvailable", "inativaQuadra1", addDays(7, 9), 90, "AVAILABLE", false, "Slot em arena inativa.");
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
  await createReservation(client, "pending", "holdPending", "org1", "SINGLE", "PENDING", 200, 60, 0, addDays(1, 23), null);
  await createReservation(client, "recurringConfirmed", "reservedRecurringParent", "org2", "RECURRING", "CONFIRMED", 200, 60, 60, null, addDays(-1, 10));
  await createReservation(client, "cancelled", "cancelledSlot", "org1", "SINGLE", "CANCELLED", 150, 45, 0, null, null);
  await createReservation(client, "consumed", "consumedZero", "org3", "SINGLE", "CONSUMED", 120, 0, 0, null, addDays(-4, 9));
  await createReservation(client, "autoZero", "autoConfirmedZero", "org1", "SINGLE", "CONFIRMED", 120, 0, 0, null, addDays(-1, 11));
  await createReservation(client, "eventArenaNorte", "eventArenaNorte", "org2", "SINGLE", "CONFIRMED", 160, 48, 48, null, addDays(-1, 12));
  await createReservation(client, "eventArenaZero", "eventArenaZero", "org3", "SINGLE", "CONFIRMED", 100, 0, 0, null, addDays(-1, 13));
}

async function seedReservationRecurrences(client: PoolClient) {
  const parentSlotStart = addDays(6, 19);
  ctx.recurrences.weeklyNorte = await insertReturningId(
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
      ctx.recurrences.weeklyNorte,
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
  await createEvent(client, "freeFutebol", {
    organizerKey: "org1",
    categoryKey: "futebol",
    title: "Futebol Amador no Umarizal",
    description: "Pelada pública para testar busca por futebol, gramado e iniciantes.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(2, 18),
    addressName: "Praça do Umarizal",
    city: "Belém",
    capacity: 20
  });
  await createEvent(client, "freeCorrida", {
    organizerKey: "org1",
    categoryKey: "corrida",
    title: "Corrida Leve na Doca",
    description: "Treino de corrida para filtros por q, cidade e data.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(4, 6),
    addressName: "Doca Boulevard",
    city: "Belém",
    capacity: 30
  });
  await createEvent(client, "freeFuncionalAlmostFull", {
    organizerKey: "org3",
    categoryKey: "funcional",
    title: "Funcional Quase Lotado",
    description: "Aula funcional com poucas vagas restantes.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(5, 7),
    addressName: "Parque Urbano",
    city: "Ananindeua",
    capacity: 4
  });
  await createEvent(client, "freeCiclismo", {
    organizerKey: "org2",
    categoryKey: "ciclismo",
    title: "Pedal Iniciante Orla",
    description: "Ciclismo urbano com rota pesquisável por pedal e orla.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(9, 6),
    addressName: "Estação das Docas",
    city: "Belém",
    capacity: 50
  });
  await createEvent(client, "freeFull", {
    organizerKey: "org3",
    categoryKey: "volei",
    title: "Vôlei Gratuito Lotado",
    description: "Evento gratuito lotado para validar capacidade.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(7, 17),
    addressName: "Praça do Vôlei",
    city: "Belém",
    capacity: 2
  });
  await createEvent(client, "paidReserved", {
    organizerKey: "org2",
    categoryKey: "beachTennis",
    title: "Beach Tennis com Booking Reservado",
    description: "Evento pago com reserva ativa aguardando pagamento PIX.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(6, 18),
    addressName: "Arena Praia Livre",
    city: "Belém",
    capacity: 8,
    price: 45
  });
  await createEvent(client, "paidCompleted", {
    organizerKey: "org1",
    categoryKey: "futebol",
    title: "Futebol Pago com Payment Concluído",
    description: "Evento pago para testar checkout e participante confirmado.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(8, 20),
    addressName: "Campo Society",
    city: "Marituba",
    capacity: 5,
    price: 35
  });
  await createEvent(client, "paidExpired", {
    organizerKey: "org2",
    categoryKey: "personal",
    title: "Personal Pago com Booking Expirado",
    description: "Evento pago com booking expirado para regressão manual.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(11, 9),
    addressName: "Studio Personal",
    city: "Belém",
    capacity: 10,
    price: 80
  });
  await createEvent(client, "paidFull", {
    organizerKey: "org2",
    categoryKey: "beachTennis",
    title: "Beach Tennis Pago Lotado",
    description: "Evento pago lotado por pagamentos já concluídos.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(14, 18),
    addressName: "Arena Praia Livre",
    city: "Belém",
    capacity: 2,
    price: 50
  });
  await createEvent(client, "privateFree", {
    organizerKey: "org1",
    categoryKey: "corrida",
    title: "Corrida Privada Empresa",
    description: "Evento privado gratuito com código PRIVATE-RUN-12.",
    type: "FREE",
    visibility: "PRIVATE",
    status: "PUBLISHED",
    start: addDays(15, 6),
    addressName: "Ponto Privado",
    city: "Belém",
    capacity: 15,
    privateCode: "PRIVATE-RUN-12"
  });
  await createEvent(client, "privatePaid", {
    organizerKey: "org2",
    categoryKey: "funcional",
    title: "Funcional Privado Pago",
    description: "Evento privado pago para testar acesso por código.",
    type: "PAID",
    visibility: "PRIVATE",
    status: "PUBLISHED",
    start: addDays(16, 8),
    addressName: "Studio Privado",
    city: "Ananindeua",
    capacity: 12,
    price: 60,
    privateCode: "PRIVATE-FIT-12"
  });
  await createEvent(client, "arenaFuncional", {
    organizerKey: "org2",
    categoryKey: "funcional",
    title: "Funcional em Arena Reservada",
    description: "Evento vinculado a reservation na Arena Norte.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(10, 8),
    addressName: "Arena Norte Recorrência",
    city: "Belém",
    capacity: 16,
    reservationKey: "eventArenaNorte"
  });
  await createEvent(client, "arenaBeach", {
    organizerKey: "org3",
    categoryKey: "beachTennis",
    title: "Beach Tennis em Arena Auto Confirma",
    description: "Evento pago em reservation de arena com pagamento mínimo zero.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    start: addDays(12, 18),
    addressName: "Arena Sul Auto Confirma",
    city: "Belém",
    capacity: 8,
    price: 40,
    reservationKey: "eventArenaZero"
  });
  await createEvent(client, "cancelled", {
    organizerKey: "org1",
    categoryKey: "ciclismo",
    title: "Pedal Cancelado Administrativo",
    description: "Evento cancelado para testar listagem e audit log.",
    type: "FREE",
    visibility: "PUBLIC",
    status: "CANCELLED",
    start: addDays(18, 6),
    addressName: "Orla Cancelada",
    city: "Belém",
    capacity: 25
  });
  await createEvent(client, "draft", {
    organizerKey: "org3",
    categoryKey: "futebol",
    title: "Rascunho de Torneio Interno",
    description: "Evento draft visível para testes do organizador/admin.",
    type: "PAID",
    visibility: "PUBLIC",
    status: "DRAFT",
    start: addDays(21, 19),
    addressName: "Campo Rascunho",
    city: "Belém",
    capacity: 12,
    price: 25
  });
}

async function seedEventParticipants(client: PoolClient) {
  const participants = [
    ["freeFutebol", "user1"],
    ["freeFuncionalAlmostFull", "user1"],
    ["freeFuncionalAlmostFull", "user2"],
    ["freeFuncionalAlmostFull", "user3"],
    ["freeFull", "user1"],
    ["freeFull", "user2"],
    ["paidCompleted", "user4"],
    ["paidFull", "user5"],
    ["paidFull", "user6"],
    ["arenaFuncional", "user2"]
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
  await createBooking(client, "reservedPaid", "paidReserved", "user3", "RESERVED", addDays(0, 9), addDays(1, 9), null);
  await createBooking(client, "completedPaid", "paidCompleted", "user4", "COMPLETED", addDays(-1, 9), addDays(1, 9), addDays(-1, 10));
  await createBooking(client, "expiredPaid", "paidExpired", "user5", "EXPIRED", addDays(-2, 9), addDays(-1, 9), null);
  await createBooking(client, "cancelledPaid", "paidReserved", "user6", "CANCELLED", addDays(-1, 11), addDays(1, 11), null);
  await createBooking(client, "paidFullUser5", "paidFull", "user5", "COMPLETED", addDays(-1, 12), addDays(1, 12), addDays(-1, 13));
  await createBooking(client, "paidFullUser6", "paidFull", "user6", "COMPLETED", addDays(-1, 14), addDays(1, 14), addDays(-1, 15));
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
      `seed-${key}`,
      amount,
      status,
      paidAt ? iso(paidAt) : null
    ]
  );
}

async function seedPayments(client: PoolClient) {
  await createPayment(client, "bookingPending", "user3", { bookingKey: "reservedPaid" }, "PENDING", 45, null);
  await createPayment(client, "bookingPaid", "user4", { bookingKey: "completedPaid" }, "PAID", 35, addDays(-1, 10));
  await createPayment(client, "bookingFailed", "user5", { bookingKey: "expiredPaid" }, "FAILED", 80, null);
  await createPayment(client, "bookingCancelled", "user6", { bookingKey: "cancelledPaid" }, "CANCELLED", 45, null);
  await createPayment(client, "bookingFullUser5", "user5", { bookingKey: "paidFullUser5" }, "PAID", 50, addDays(-1, 13));
  await createPayment(client, "bookingFullUser6", "user6", { bookingKey: "paidFullUser6" }, "PAID", 50, addDays(-1, 15));
  await createPayment(client, "reservationPending", "org1", { reservationKey: "pending" }, "PENDING", 60, null);
  await createPayment(client, "reservationPaid", "org2", { reservationKey: "recurringConfirmed" }, "PAID", 60, addDays(-1, 10));
  await createPayment(client, "occurrencePaid", "org2", { occurrenceKey: "occConfirmed" }, "PAID", 200, addDays(-1, 10));
  await createPayment(client, "occurrenceFailed", "org2", { occurrenceKey: "occReleased" }, "FAILED", 200, null);
}

async function seedNotifications(client: PoolClient) {
  const notifications = [
    ["user4", "Pagamento confirmado", "Seu pagamento do Futebol Pago com Payment Concluído foi aprovado.", "PAYMENT_CONFIRMED", null],
    ["user5", "Pagamento confirmado", "Seu pagamento do Beach Tennis Pago Lotado foi aprovado.", "PAYMENT_CONFIRMED", addDays(0, 8)],
    ["user6", "Booking cancelado", "Seu booking no Beach Tennis com Booking Reservado foi cancelado.", "BOOKING_CANCELLED", null],
    ["org2", "Pagamento da reserva confirmado", "Pagamento da reserva recorrente foi confirmado.", "PAYMENT_CONFIRMED", addDays(0, 9)]
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
      ctx.arenas.arenaInativa,
      "Arena marcada como inativa para homologação.",
      { previousStatus: "ACTIVE", nextStatus: "INACTIVE", seed: true }
    ],
    [
      "EVENT_CANCELLED",
      "EVENT",
      ctx.events.cancelled,
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
