import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { CreateArenaInput, PatchArenaInput } from "./schemas";

function slugifyArenaName(name: string): string {
  const n = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return n.length ? n : "arena";
}

export function buildUniqueArenaSlug(name: string): string {
  return `${slugifyArenaName(name)}-${randomBytes(4).toString("hex")}`;
}

export async function createArena(pool: Pool, ownerId: string, input: CreateArenaInput) {
  const client = await pool.connect();
  const slug = buildUniqueArenaSlug(input.name);

  try {
    await client.query("BEGIN");

    const arenaRes = await client.query<{ id: string; name: string; status: string }>(
      `
        INSERT INTO arenas (owner_id, name, slug, description, phone, email, document, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
        RETURNING id, name, status::text
      `,
      [
        ownerId,
        input.name,
        slug,
        input.description ?? null,
        input.phone,
        input.email,
        input.document
      ]
    );

    const arena = arenaRes.rows[0];
    if (!arena) {
      throw new AppError({ status: 500, code: "ARENA_CREATE_FAILED", message: "Arena create failed" });
    }

    await client.query(
      `
        INSERT INTO arena_addresses (arena_id, zip_code, street, number, district, city, state)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        arena.id,
        input.address.zipCode,
        input.address.street,
        input.address.number,
        input.address.district,
        input.address.city,
        input.address.state
      ]
    );

    await client.query(
      `
        INSERT INTO arena_policies (
          arena_id, allow_recurring, min_advance_hours, min_reservation_payment_percent
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        arena.id,
        input.policy.allowRecurring,
        input.policy.minAdvanceHours,
        input.policy.minReservationPaymentPercent
      ]
    );

    await client.query("COMMIT");
    return { id: arena.id, name: arena.name, status: arena.status };
  } catch (err) {
    await client.query("ROLLBACK");
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      throw new AppError({ status: 409, code: "ARENA_SLUG_CONFLICT", message: "Arena slug conflict" });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function getArenaById(pool: Pool, id: string) {
  const res = await pool.query(
    `
      SELECT
        a.id,
        a.owner_id,
        a.name,
        a.slug::text AS slug,
        a.description,
        a.phone,
        a.email::text AS email,
        a.document,
        a.status::text AS status,
        a.created_at,
        a.updated_at,
        ad.zip_code,
        ad.street,
        ad.number,
        ad.district,
        ad.city,
        ad.state,
        ad.latitude,
        ad.longitude,
        p.allow_recurring,
        p.min_advance_hours,
        p.min_reservation_payment_percent
      FROM arenas a
      LEFT JOIN arena_addresses ad ON ad.arena_id = a.id
      LEFT JOIN arena_policies p ON p.arena_id = a.id
      WHERE a.id = $1
      LIMIT 1
    `,
    [id]
  );

  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new AppError({ status: 404, code: "ARENA_NOT_FOUND", message: "Arena not found" });
  }

  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    phone: row.phone,
    email: row.email,
    document: row.document,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    address: {
      zipCode: row.zip_code,
      street: row.street,
      number: row.number,
      district: row.district,
      city: row.city,
      state: row.state,
      latitude: row.latitude,
      longitude: row.longitude
    },
    policy: {
      allowRecurring: row.allow_recurring,
      minAdvanceHours: row.min_advance_hours,
      minReservationPaymentPercent: row.min_reservation_payment_percent
    }
  };
}

export async function updateArena(pool: Pool, id: string, input: PatchArenaInput) {
  const existing = await pool.query(`SELECT id FROM arenas WHERE id = $1 LIMIT 1`, [id]);
  if (!existing.rowCount) {
    throw new AppError({ status: 404, code: "ARENA_NOT_FOUND", message: "Arena not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${i++}`);
      vals.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${i++}`);
      vals.push(input.description);
    }
    if (input.phone !== undefined) {
      sets.push(`phone = $${i++}`);
      vals.push(input.phone);
    }
    if (input.email !== undefined) {
      sets.push(`email = $${i++}`);
      vals.push(input.email);
    }
    if (input.document !== undefined) {
      sets.push(`document = $${i++}`);
      vals.push(input.document);
    }
    if (input.status !== undefined) {
      sets.push(`status = $${i++}::arena_status`);
      vals.push(input.status);
    }

    if (sets.length) {
      sets.push("updated_at = now()");
      vals.push(id);
      await client.query(
        `
          UPDATE arenas
          SET ${sets.join(", ")}
          WHERE id = $${i}
        `,
        vals
      );
    }

    if (input.address) {
      const a = input.address;
      const addrSets: string[] = [];
      const addrVals: unknown[] = [];
      let j = 1;
      if (a.zipCode !== undefined) {
        addrSets.push(`zip_code = $${j++}`);
        addrVals.push(a.zipCode);
      }
      if (a.street !== undefined) {
        addrSets.push(`street = $${j++}`);
        addrVals.push(a.street);
      }
      if (a.number !== undefined) {
        addrSets.push(`number = $${j++}`);
        addrVals.push(a.number);
      }
      if (a.district !== undefined) {
        addrSets.push(`district = $${j++}`);
        addrVals.push(a.district);
      }
      if (a.city !== undefined) {
        addrSets.push(`city = $${j++}`);
        addrVals.push(a.city);
      }
      if (a.state !== undefined) {
        addrSets.push(`state = $${j++}`);
        addrVals.push(a.state);
      }
      if (addrSets.length) {
        addrSets.push("updated_at = now()");
        addrVals.push(id);
        await client.query(
          `
            UPDATE arena_addresses
            SET ${addrSets.join(", ")}
            WHERE arena_id = $${j}
          `,
          addrVals
        );
      }
    }

    if (input.policy) {
      const p = input.policy;
      const polSets: string[] = [];
      const polVals: unknown[] = [];
      let k = 1;
      if (p.allowRecurring !== undefined) {
        polSets.push(`allow_recurring = $${k++}`);
        polVals.push(p.allowRecurring);
      }
      if (p.minAdvanceHours !== undefined) {
        polSets.push(`min_advance_hours = $${k++}`);
        polVals.push(p.minAdvanceHours);
      }
      if (p.minReservationPaymentPercent !== undefined) {
        polSets.push(`min_reservation_payment_percent = $${k++}`);
        polVals.push(p.minReservationPaymentPercent);
      }
      if (polSets.length) {
        polSets.push("updated_at = now()");
        polVals.push(id);
        await client.query(
          `
            UPDATE arena_policies
            SET ${polSets.join(", ")}
            WHERE arena_id = $${k}
          `,
          polVals
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getArenaById(pool, id);
}
