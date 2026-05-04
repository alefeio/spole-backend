import type { Pool } from "pg";
import type { AppDeps } from "../../app";
import {
  getPublicCatalogVersion,
  getReadThroughJson,
  publicCategoriesCacheKey,
  type PublicCategoriesCachedResult
} from "../../shared/cache/public-catalog-cache";
import { AppError } from "../../shared/errors/app-error";
import type { CategoryStatus, CreateCategoryInput, PatchCategoryInput } from "./schemas";

export type EventCategoryRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  status: CategoryStatus;
};

export type PublicCategoryRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
};

export async function createCategory(pool: Pool, input: CreateCategoryInput): Promise<EventCategoryRow> {
  const status: CategoryStatus = input.status ?? "ACTIVE";

  try {
    const res = await pool.query<EventCategoryRow>(
      `
        INSERT INTO event_categories (name, slug, icon, status)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, slug::text, icon, status::text
      `,
      [input.name, input.slug, input.icon ?? null, status]
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

export async function listPublicCategoriesFromDb(pool: Pool): Promise<PublicCategoriesCachedResult> {
  const res = await pool.query<PublicCategoryRow>(
    `
      SELECT id, name, slug::text, icon
      FROM event_categories
      WHERE status = 'ACTIVE'
      ORDER BY name ASC
    `
  );
  return res.rows;
}

export async function listPublicCategories(deps: AppDeps): Promise<PublicCategoriesCachedResult> {
  const ttl = deps.env.publicReadCacheTtlSeconds;
  const version = await getPublicCatalogVersion(deps.redis);
  const key = publicCategoriesCacheKey(version);
  return getReadThroughJson(deps.redis, key, ttl, () => listPublicCategoriesFromDb(deps.pool));
}

export async function getCategoryById(pool: Pool, id: string): Promise<EventCategoryRow | null> {
  const res = await pool.query<EventCategoryRow>(
    `
      SELECT id, name, slug::text, icon, status::text
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
  const status = input.status ?? existing.status;

  try {
    const res = await pool.query<EventCategoryRow>(
      `
        UPDATE event_categories
        SET name = $2, slug = $3, icon = $4, status = $5, updated_at = now()
        WHERE id = $1
        RETURNING id, name, slug::text, icon, status::text
      `,
      [id, name, slug, icon, status]
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
