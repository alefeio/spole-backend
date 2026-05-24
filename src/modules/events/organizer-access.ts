import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { AuthUser } from "../../types/auth";
import { loadEvent, type DbEvent } from "./service";

export async function assertEventOrganizerOrAdmin(pool: Pool, eventId: string, auth: AuthUser): Promise<DbEvent> {
  const row = await loadEvent(pool, eventId);
  if (!row) {
    throw new AppError({ status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" });
  }
  if (auth.role !== "admin" && auth.id !== row.organizer_id) {
    throw new AppError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  }
  return row;
}
