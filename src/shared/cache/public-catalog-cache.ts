import { createHash } from "node:crypto";
import type { RedisAppClient } from "./redis/redis";

/** Versão global do catálogo público; `INCR` invalida entradas antigas por TTL sem usar KEYS. */
export const PUBLIC_CATALOG_CACHE_VERSION_KEY = "spole:cache:publicCatalogVersion";

export type PublicListEventsCachedResult = {
  data: Array<{
    id: string;
    title: string;
    type: string;
    visibility: string;
    city: string;
    state: string;
    startAt: string;
    capacity: number;
    pricePerPerson: number | null;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    sort: string;
    order: string;
  };
};

export type PublicCategoriesCachedResult = Array<{
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}>;

/** Chave estável para deduplicar cache (campos alinhados ao contrato de listagem). */
export function stableEventsQueryKey(query: {
  page: number;
  limit: number;
  category?: string;
  city?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: "FREE" | "PAID";
  sort: string;
  order: string;
  q?: string;
}): string {
  return JSON.stringify({
    category: query.category ?? null,
    city: query.city ?? null,
    dateFrom: query.dateFrom ?? null,
    dateTo: query.dateTo ?? null,
    limit: query.limit,
    order: query.order,
    page: query.page,
    q: query.q ?? null,
    sort: query.sort,
    type: query.type ?? null
  });
}

export function publicEventsCacheKey(version: string, query: Parameters<typeof stableEventsQueryKey>[0]): string {
  const h = createHash("sha256").update(stableEventsQueryKey(query)).digest("hex").slice(0, 32);
  return `spole:cache:public:v${version}:events:${h}`;
}

export function publicCategoriesCacheKey(version: string): string {
  return `spole:cache:public:v${version}:categories`;
}

export async function getPublicCatalogVersion(redis: RedisAppClient): Promise<string> {
  try {
    const v = await redis.get(PUBLIC_CATALOG_CACHE_VERSION_KEY);
    return v != null && v.length > 0 ? v : "0";
  } catch {
    return "0";
  }
}

export async function bumpPublicCatalogVersion(redis: RedisAppClient): Promise<void> {
  try {
    await redis.incr(PUBLIC_CATALOG_CACHE_VERSION_KEY);
  } catch {
    /* fallback: listagens continuam a servir a partir do Postgres */
  }
}

export async function getReadThroughJson<T>(
  redis: RedisAppClient,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>
): Promise<T> {
  try {
    const raw = await redis.get(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    /* miss ou parse inválido → Postgres */
  }

  const value = await load();
  try {
    await redis.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch {
    /* escrita em cache falhou; resposta já é válida */
  }
  return value;
}
