import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { AuthUser } from "../../types/auth";
import type { CreateEventInput, ListEventsQuery, PatchEventInput } from "./schemas";

type DbEvent = {
  id: string;
  organizer_id: string;
  category_id: string;
  title: string;
  description: string | null;
  type: "FREE" | "PAID";
  visibility: "PUBLIC" | "PRIVATE";
  source_type: "FREE_LOCATION";
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  start_at: string;
  end_at: string;
  address_name: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  capacity: number;
  price_per_person: string | null;
};

function numFromDb(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validateEventRules(params: {
  type: "FREE" | "PAID";
  pricePerPerson: number | null;
  startAt: Date;
  endAt: Date;
  capacity: number;
}) {
  if (params.endAt <= params.startAt) {
    throw new AppError({
      status: 422,
      code: "INVALID_DATE_RANGE",
      message: "endAt must be after startAt"
    });
  }
  if (params.capacity <= 0) {
    throw new AppError({ status: 422, code: "INVALID_CAPACITY", message: "capacity must be greater than zero" });
  }
  if (params.type === "PAID") {
    if (params.pricePerPerson == null || params.pricePerPerson <= 0) {
      throw new AppError({
        status: 422,
        code: "INVALID_PRICE",
        message: "Paid events require pricePerPerson > 0"
      });
    }
  } else if (params.pricePerPerson != null && params.pricePerPerson > 0) {
    throw new AppError({
      status: 422,
      code: "INVALID_PRICE",
      message: "Free events must not have a positive price"
    });
  }
}

async function assertCategoryExists(pool: Pool, categoryId: string) {
  const r = await pool.query(`SELECT 1 FROM event_categories WHERE id = $1 LIMIT 1`, [categoryId]);
  if (!r.rowCount) {
    throw new AppError({ status: 422, code: "INVALID_CATEGORY", message: "Category not found" });
  }
}

async function loadEvent(pool: Pool, id: string): Promise<DbEvent | null> {
  const res = await pool.query<DbEvent>(
    `
      SELECT
        id, organizer_id, category_id, title, description, type::text, visibility::text,
        source_type::text, status::text, start_at, end_at, address_name, street, number,
        district, city, state, capacity, price_per_person::text
      FROM events
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  return res.rows[0] ?? null;
}

function canAccessEventDetail(row: DbEvent, auth?: AuthUser): boolean {
  const ownerOrAdmin = auth && (auth.role === "admin" || auth.id === row.organizer_id);
  if (ownerOrAdmin) return true;

  const publicReadable =
    row.visibility === "PUBLIC" && (row.status === "PUBLISHED" || row.status === "CANCELLED");
  return publicReadable;
}

export async function createEvent(pool: Pool, organizerId: string, input: CreateEventInput) {
  await assertCategoryExists(pool, input.categoryId);

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const price = input.type === "PAID" ? input.pricePerPerson ?? null : null;

  validateEventRules({
    type: input.type,
    pricePerPerson: price,
    startAt,
    endAt,
    capacity: input.capacity
  });

  const res = await pool.query<DbEvent>(
    `
      INSERT INTO events (
        organizer_id, category_id, title, description, type, visibility, source_type, status,
        start_at, end_at, address_name, street, number, district, city, state, capacity, price_per_person
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING
        id, organizer_id, category_id, title, description, type::text, visibility::text,
        source_type::text, status::text, start_at, end_at, address_name, street, number,
        district, city, state, capacity, price_per_person::text
    `,
    [
      organizerId,
      input.categoryId,
      input.title,
      input.description ?? null,
      input.type,
      input.visibility,
      input.sourceType,
      input.status,
      input.startAt,
      input.endAt,
      input.addressName,
      input.street,
      input.number,
      input.district,
      input.city,
      input.state,
      input.capacity,
      price
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppError({ status: 500, code: "EVENT_CREATE_FAILED", message: "Event create failed" });
  }

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    visibility: row.visibility,
    status: row.status
  };
}

export async function listPublicEvents(pool: Pool, query: ListEventsQuery) {
  const conditions = [`e.visibility = 'PUBLIC'`, `e.status = 'PUBLISHED'`];
  const params: unknown[] = [];
  let i = 1;

  if (query.category) {
    conditions.push(`e.category_id = $${i++}`);
    params.push(query.category);
  }
  if (query.city) {
    conditions.push(`e.city ILIKE $${i++}`);
    params.push(`%${query.city}%`);
  }
  if (query.dateFrom) {
    conditions.push(`e.start_at >= $${i++}`);
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    conditions.push(`e.start_at <= $${i++}`);
    params.push(query.dateTo);
  }
  if (query.type) {
    conditions.push(`e.type = $${i++}::event_type`);
    params.push(query.type);
  }

  const whereSql = conditions.join(" AND ");
  const offset = (query.page - 1) * query.limit;

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM events e WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  params.push(query.limit, offset);
  const limitIdx = i++;
  const offsetIdx = i++;

  const listRes = await pool.query<DbEvent>(
    `
      SELECT
        e.id, e.organizer_id, e.category_id, e.title, e.description, e.type::text, e.visibility::text,
        e.source_type::text, e.status::text, e.start_at, e.end_at, e.address_name, e.street, e.number,
        e.district, e.city, e.state, e.capacity, e.price_per_person::text
      FROM events e
      WHERE ${whereSql}
      ORDER BY e.start_at ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  const data = listRes.rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    visibility: row.visibility,
    city: row.city,
    state: row.state,
    startAt: row.start_at,
    capacity: row.capacity,
    pricePerPerson: numFromDb(row.price_per_person)
  }));

  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total
    }
  };
}

export function mapEventDetail(row: DbEvent) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    visibility: row.visibility,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    addressName: row.address_name,
    city: row.city,
    state: row.state,
    capacity: row.capacity,
    pricePerPerson: numFromDb(row.price_per_person)
  };
}

export async function getEventDetail(pool: Pool, id: string, auth?: AuthUser) {
  const row = await loadEvent(pool, id);
  if (!row) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }

  if (!canAccessEventDetail(row, auth)) {
    throw new AppError({
      status: 403,
      code: "FORBIDDEN",
      message: "You do not have access to this event"
    });
  }

  return mapEventDetail(row);
}

export async function updateEvent(pool: Pool, id: string, auth: AuthUser, input: PatchEventInput) {
  const row = await loadEvent(pool, id);
  if (!row) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }

  if (auth.role !== "admin" && auth.id !== row.organizer_id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  if (row.status === "CANCELLED") {
    throw new AppError({
      status: 422,
      code: "EVENT_CANCELLED",
      message: "Cancelled events cannot be updated"
    });
  }

  if (input.categoryId) {
    await assertCategoryExists(pool, input.categoryId);
  }

  const merged = {
    category_id: input.categoryId ?? row.category_id,
    title: input.title ?? row.title,
    description: input.description === undefined ? row.description : input.description,
    type: (input.type ?? row.type) as "FREE" | "PAID",
    visibility: (input.visibility ?? row.visibility) as "PUBLIC" | "PRIVATE",
    status: (input.status ?? row.status) as "DRAFT" | "PUBLISHED" | "CANCELLED",
    start_at: input.startAt ?? row.start_at,
    end_at: input.endAt ?? row.end_at,
    address_name: input.addressName ?? row.address_name,
    street: input.street ?? row.street,
    number: input.number ?? row.number,
    district: input.district ?? row.district,
    city: input.city ?? row.city,
    state: input.state ?? row.state,
    capacity: input.capacity ?? row.capacity,
    price_per_person:
      input.pricePerPerson === undefined
        ? row.price_per_person
        : input.pricePerPerson == null
          ? null
          : String(input.pricePerPerson)
  };

  if (merged.status === "CANCELLED") {
    throw new AppError({ status: 422, code: "INVALID_STATUS", message: "Use DELETE to cancel an event" });
  }

  const startAt = new Date(merged.start_at);
  const endAt = new Date(merged.end_at);
  const priceNum = merged.price_per_person == null ? null : Number(merged.price_per_person);

  validateEventRules({
    type: merged.type,
    pricePerPerson: priceNum,
    startAt,
    endAt,
    capacity: merged.capacity
  });

  const res = await pool.query<DbEvent>(
    `
      UPDATE events SET
        category_id = $2,
        title = $3,
        description = $4,
        type = $5,
        visibility = $6,
        status = $7,
        start_at = $8,
        end_at = $9,
        address_name = $10,
        street = $11,
        number = $12,
        district = $13,
        city = $14,
        state = $15,
        capacity = $16,
        price_per_person = $17,
        updated_at = now()
      WHERE id = $1
      RETURNING
        id, organizer_id, category_id, title, description, type::text, visibility::text,
        source_type::text, status::text, start_at, end_at, address_name, street, number,
        district, city, state, capacity, price_per_person::text
    `,
    [
      id,
      merged.category_id,
      merged.title,
      merged.description,
      merged.type,
      merged.visibility,
      merged.status,
      merged.start_at,
      merged.end_at,
      merged.address_name,
      merged.street,
      merged.number,
      merged.district,
      merged.city,
      merged.state,
      merged.capacity,
      priceNum
    ]
  );

  const updated = res.rows[0];
  if (!updated) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }

  return { id: updated.id, title: updated.title };
}

export async function cancelEvent(pool: Pool, id: string, auth: AuthUser) {
  const row = await loadEvent(pool, id);
  if (!row) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }

  if (auth.role !== "admin" && auth.id !== row.organizer_id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }

  if (row.status === "CANCELLED") {
    return { id: row.id, status: "CANCELLED" as const };
  }

  await pool.query(
    `
      UPDATE events
      SET status = 'CANCELLED', updated_at = now()
      WHERE id = $1
    `,
    [id]
  );

  return { id, status: "CANCELLED" as const };
}
