import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import { generatePrivateEventCode, safeEqualStrings } from "../../shared/security/private-code";
import type { AuthUser } from "../../types/auth";
import type {
  CreateEventArenaReservationInput,
  CreateEventFreeLocationInput,
  CreateEventInput,
  ListEventsQuery,
  PatchEventInput
} from "./schemas";

type DbEvent = {
  id: string;
  organizer_id: string;
  category_id: string;
  title: string;
  description: string | null;
  type: "FREE" | "PAID";
  visibility: "PUBLIC" | "PRIVATE";
  source_type: "FREE_LOCATION" | "ARENA_RESERVATION";
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
  private_code: string | null;
  reservation_id: string | null;
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

async function assertCategoryForEvent(pool: Pool, categoryId: string) {
  const r = await pool.query<{ status: string }>(
    `SELECT status::text FROM event_categories WHERE id = $1 LIMIT 1`,
    [categoryId]
  );
  const row = r.rows[0];
  if (!row) {
    throw new AppError({ status: 422, code: "INVALID_CATEGORY", message: "Category not found" });
  }
  if (row.status !== "ACTIVE") {
    throw new AppError({
      status: 422,
      code: "INACTIVE_CATEGORY",
      message: "Category is not active"
    });
  }
}

async function loadEvent(pool: Pool, id: string): Promise<DbEvent | null> {
  const res = await pool.query<DbEvent>(
    `
      SELECT
        id, organizer_id, category_id, title, description, type::text, visibility::text,
        source_type::text, status::text, start_at, end_at, address_name, street, number,
        district, city, state, capacity, price_per_person::text, private_code, reservation_id
      FROM events
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  return res.rows[0] ?? null;
}

function canAccessEventDetail(
  row: DbEvent,
  auth: AuthUser | undefined,
  queryPrivateCode: string | undefined
): boolean {
  const ownerOrAdmin = auth && (auth.role === "admin" || auth.id === row.organizer_id);
  if (ownerOrAdmin) return true;

  const publicReadable =
    row.visibility === "PUBLIC" && (row.status === "PUBLISHED" || row.status === "CANCELLED");
  if (publicReadable) return true;

  if (row.visibility === "PRIVATE" && row.private_code && queryPrivateCode) {
    const a = row.private_code.trim();
    const b = queryPrivateCode.trim();
    if (a.length > 0 && b.length > 0 && safeEqualStrings(a, b)) return true;
  }

  return false;
}

function shouldIncludePrivateCodeInDetail(row: DbEvent, auth: AuthUser | undefined): boolean {
  return Boolean(auth && (auth.role === "admin" || auth.id === row.organizer_id));
}

function mapCreatedEvent(row: DbEvent) {
  const base = {
    id: row.id,
    title: row.title,
    type: row.type,
    visibility: row.visibility,
    status: row.status
  };
  if (row.visibility === "PRIVATE" && row.private_code) {
    return { ...base, privateCode: row.private_code };
  }
  return base;
}

async function createFreeLocationEvent(pool: Pool, organizerId: string, input: CreateEventFreeLocationInput) {
  await assertCategoryForEvent(pool, input.categoryId);

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const price = input.type === "PAID" ? input.pricePerPerson ?? null : null;

  const privateCode =
    input.visibility === "PRIVATE"
      ? (input.privateCode?.trim() && input.privateCode.trim().length >= 8
          ? input.privateCode.trim()
          : generatePrivateEventCode())
      : null;

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
        start_at, end_at, address_name, street, number, district, city, state, capacity, price_per_person,
        private_code, reservation_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NULL)
      RETURNING
        id, organizer_id, category_id, title, description, type::text, visibility::text,
        source_type::text, status::text, start_at, end_at, address_name, street, number,
        district, city, state, capacity, price_per_person::text, private_code, reservation_id
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
      price,
      privateCode
    ]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppError({ status: 500, code: "EVENT_CREATE_FAILED", message: "Event create failed" });
  }

  return mapCreatedEvent(row);
}

async function createArenaReservationEvent(pool: Pool, organizerId: string, input: CreateEventArenaReservationInput) {
  await assertCategoryForEvent(pool, input.categoryId);

  const price = input.type === "PAID" ? input.pricePerPerson ?? null : null;

  const privateCode =
    input.visibility === "PRIVATE"
      ? (input.privateCode?.trim() && input.privateCode.trim().length >= 8
          ? input.privateCode.trim()
          : generatePrivateEventCode())
      : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ctxRes = await client.query<{
      res_id: string;
      res_status: string;
      res_organizer: string;
      slot_id: string;
      slot_status: string;
      start_at: string;
      end_at: string;
      arena_name: string;
      street: string | null;
      number: string | null;
      district: string | null;
      city: string | null;
      state: string | null;
    }>(
      `
        SELECT
          r.id AS res_id,
          r.status::text AS res_status,
          r.organizer_id AS res_organizer,
          s.id AS slot_id,
          s.status::text AS slot_status,
          s.start_at,
          s.end_at,
          a.name AS arena_name,
          ad.street,
          ad.number,
          ad.district,
          ad.city,
          ad.state
        FROM reservations r
        INNER JOIN arena_slots s ON s.id = r.slot_id
        INNER JOIN arena_spaces sp ON sp.id = s.space_id
        INNER JOIN arenas a ON a.id = sp.arena_id
        LEFT JOIN arena_addresses ad ON ad.arena_id = a.id
        WHERE r.id = $1
        FOR UPDATE OF r, s
      `,
      [input.reservationId]
    );
    const ctx = ctxRes.rows[0];
    if (!ctx) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 404, code: "RESERVATION_NOT_FOUND", message: "Reservation not found" });
    }
    if (ctx.res_organizer !== organizerId) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 403,
        code: "FORBIDDEN",
        message: "Reservation does not belong to this user"
      });
    }
    if (ctx.res_status !== "CONFIRMED") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "RESERVATION_INVALID_STATE",
        message: "Reservation is not available for creating an event"
      });
    }
    if (ctx.slot_status !== "RESERVED") {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "SLOT_INVALID_STATE",
        message: "Slot is not in a valid state for this reservation"
      });
    }

    if (!ctx.street || !ctx.number || !ctx.district || !ctx.city || !ctx.state) {
      await client.query("ROLLBACK");
      throw new AppError({
        status: 422,
        code: "ARENA_ADDRESS_MISSING",
        message: "Arena address is required to create this event"
      });
    }

    const startAt = new Date(ctx.start_at);
    const endAt = new Date(ctx.end_at);

    validateEventRules({
      type: input.type,
      pricePerPerson: price,
      startAt,
      endAt,
      capacity: input.capacity
    });

    const ins = await client.query<DbEvent>(
      `
        INSERT INTO events (
          organizer_id, category_id, title, description, type, visibility, source_type, status,
          start_at, end_at, address_name, street, number, district, city, state, capacity, price_per_person,
          private_code, reservation_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 'ARENA_RESERVATION', $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING
          id, organizer_id, category_id, title, description, type::text, visibility::text,
          source_type::text, status::text, start_at, end_at, address_name, street, number,
          district, city, state, capacity, price_per_person::text, private_code, reservation_id
      `,
      [
        organizerId,
        input.categoryId,
        input.title,
        input.description ?? null,
        input.type,
        input.visibility,
        input.status,
        ctx.start_at,
        ctx.end_at,
        ctx.arena_name,
        ctx.street,
        ctx.number,
        ctx.district,
        ctx.city,
        ctx.state,
        input.capacity,
        price,
        privateCode,
        input.reservationId
      ]
    );

    const row = ins.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new AppError({ status: 500, code: "EVENT_CREATE_FAILED", message: "Event create failed" });
    }

    await client.query(
      `UPDATE reservations SET status = 'CONSUMED', updated_at = now() WHERE id = $1`,
      [input.reservationId]
    );

    await client.query("COMMIT");
    return mapCreatedEvent(row);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function createEvent(pool: Pool, organizerId: string, input: CreateEventInput) {
  if (input.sourceType === "ARENA_RESERVATION") {
    return createArenaReservationEvent(pool, organizerId, input);
  }
  return createFreeLocationEvent(pool, organizerId, input);
}

export async function listPublicEvents(pool: Pool, query: ListEventsQuery) {
  const conditions = [`e.visibility = 'PUBLIC'`, `e.status = 'PUBLISHED'`, `c.status = 'ACTIVE'`];
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
  const orderDir = query.order === "desc" ? "DESC" : "ASC";

  const countRes = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM events e
      INNER JOIN event_categories c ON c.id = e.category_id
      WHERE ${whereSql}
    `,
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
        e.district, e.city, e.state, e.capacity, e.price_per_person::text, e.private_code, e.reservation_id
      FROM events e
      INNER JOIN event_categories c ON c.id = e.category_id
      WHERE ${whereSql}
      ORDER BY e.start_at ${orderDir}
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
      total,
      sort: query.sort,
      order: query.order
    }
  };
}

export function mapEventDetail(row: DbEvent, includeOrganizerFields: boolean) {
  const base: Record<string, unknown> = {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    visibility: row.visibility,
    status: row.status,
    sourceType: row.source_type,
    startAt: row.start_at,
    endAt: row.end_at,
    addressName: row.address_name,
    city: row.city,
    state: row.state,
    capacity: row.capacity,
    pricePerPerson: numFromDb(row.price_per_person)
  };
  if (includeOrganizerFields && row.private_code) {
    base.privateCode = row.private_code;
  }
  if (includeOrganizerFields && row.reservation_id) {
    base.reservationId = row.reservation_id;
  }
  return base as {
    id: string;
    title: string;
    description: string | null;
    type: string;
    visibility: string;
    status: string;
    sourceType: string;
    startAt: string;
    endAt: string;
    addressName: string;
    city: string;
    state: string;
    capacity: number;
    pricePerPerson: number | null;
    privateCode?: string;
    reservationId?: string;
  };
}

export async function getEventDetail(
  pool: Pool,
  id: string,
  auth: AuthUser | undefined,
  queryPrivateCode: string | undefined
) {
  const row = await loadEvent(pool, id);
  if (!row) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }

  if (!canAccessEventDetail(row, auth, queryPrivateCode)) {
    throw new AppError({
      status: 403,
      code: "FORBIDDEN",
      message: "You do not have access to this event"
    });
  }

  const includeOrganizerFields = shouldIncludePrivateCodeInDetail(row, auth);
  return mapEventDetail(row, includeOrganizerFields);
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
    await assertCategoryForEvent(pool, input.categoryId);
  }

  const mergedVisibility = (input.visibility ?? row.visibility) as "PUBLIC" | "PRIVATE";

  let mergedPrivateCode = row.private_code;
  if (input.privateCode !== undefined) {
    mergedPrivateCode = input.privateCode.trim();
  }

  if (mergedVisibility === "PUBLIC") {
    mergedPrivateCode = null;
  } else if (!mergedPrivateCode || mergedPrivateCode.trim().length < 8) {
    mergedPrivateCode = generatePrivateEventCode();
  }

  const merged = {
    category_id: input.categoryId ?? row.category_id,
    title: input.title ?? row.title,
    description: input.description === undefined ? row.description : input.description,
    type: (input.type ?? row.type) as "FREE" | "PAID",
    visibility: mergedVisibility,
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
          : String(input.pricePerPerson),
    private_code: mergedPrivateCode
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
        private_code = $18,
        updated_at = now()
      WHERE id = $1
      RETURNING
        id, organizer_id, category_id, title, description, type::text, visibility::text,
        source_type::text, status::text, start_at, end_at, address_name, street, number,
        district, city, state, capacity, price_per_person::text, private_code, reservation_id
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
      priceNum,
      merged.private_code
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE events
        SET status = 'CANCELLED', updated_at = now()
        WHERE id = $1
      `,
      [id]
    );

    if (row.source_type === "ARENA_RESERVATION" && row.reservation_id) {
      await client.query(
        `
          UPDATE arena_slots s
          SET status = 'AVAILABLE', updated_at = now()
          FROM reservations r
          WHERE r.id = $1 AND s.id = r.slot_id
        `,
        [row.reservation_id]
      );
      await client.query(
        `
          UPDATE reservations
          SET status = 'CANCELLED', updated_at = now()
          WHERE id = $1 AND status = 'CONSUMED'
        `,
        [row.reservation_id]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return { id, status: "CANCELLED" as const };
}
