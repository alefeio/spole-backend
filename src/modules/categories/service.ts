import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { CreateCategoryInput, PatchCategoryInput } from "./schemas";

export type EventCategoryRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
};

export async function createCategory(pool: Pool, input: CreateCategoryInput): Promise<EventCategoryRow> {
  try {
    const res = await pool.query<EventCategoryRow>(
      `
        INSERT INTO event_categories (name, slug, icon)
        VALUES ($1, $2, $3)
        RETURNING id, name, slug::text, icon
      `,
      [input.name, input.slug, input.icon ?? null]
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError({ status: 500, code: "CATEGORY_CREATE_FAILED", message: "Category create failed" });
    }
    return row;
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      throw new AppError({ status: 409, code: "SLUG_ALREADY_EXISTS", message: "Slug already exists" });
    }
    throw err;
  }
}

export async function listCategories(pool: Pool): Promise<EventCategoryRow[]> {
  const res = await pool.query<EventCategoryRow>(
    `
      SELECT id, name, slug::text, icon
      FROM event_categories
      ORDER BY name ASC
    `
  );
  return res.rows;
}

export async function getCategoryById(pool: Pool, id: string): Promise<EventCategoryRow | null> {
  const res = await pool.query<EventCategoryRow>(
    `
      SELECT id, name, slug::text, icon
      FROM event_categories
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function updateCategory(
  pool: Pool,
  id: string,
  input: PatchCategoryInput
): Promise<EventCategoryRow> {
  const existing = await getCategoryById(pool, id);
  if (!existing) {
    throw new AppError({ status: 404, code: "CATEGORY_NOT_FOUND", message: "Category not found" });
  }

  const name = input.name ?? existing.name;
  const slug = input.slug ?? existing.slug;
  const icon = input.icon === undefined ? existing.icon : input.icon;

  try {
    const res = await pool.query<EventCategoryRow>(
      `
        UPDATE event_categories
        SET name = $2, slug = $3, icon = $4, updated_at = now()
        WHERE id = $1
        RETURNING id, name, slug::text, icon
      `,
      [id, name, slug, icon]
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError({ status: 404, code: "CATEGORY_NOT_FOUND", message: "Category not found" });
    }
    return row;
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      throw new AppError({ status: 409, code: "SLUG_ALREADY_EXISTS", message: "Slug already exists" });
    }
    throw err;
  }
}

export async function deleteCategory(pool: Pool, id: string): Promise<void> {
  const existing = await getCategoryById(pool, id);
  if (!existing) {
    throw new AppError({ status: 404, code: "CATEGORY_NOT_FOUND", message: "Category not found" });
  }

  const used = await pool.query(`SELECT 1 FROM events WHERE category_id = $1 LIMIT 1`, [id]);
  if (used.rowCount) {
    throw new AppError({
      status: 409,
      code: "CATEGORY_IN_USE",
      message: "Category is referenced by events"
    });
  }

  await pool.query(`DELETE FROM event_categories WHERE id = $1`, [id]);
}
