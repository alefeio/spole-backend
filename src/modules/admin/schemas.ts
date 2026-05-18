import { z } from "zod";
import { paginationQuerySchema } from "../../shared/http/pagination";

export const adminUsersListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]).optional(),
  role: z.enum(["user", "arena_owner", "admin"]).optional(),
  email: z.string().trim().max(200).optional()
});

export const patchUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]),
  reason: z.string().trim().min(1).max(500)
});

export const adminArenasListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  ownerId: z.string().uuid().optional(),
  city: z.string().trim().max(100).optional()
});

export const patchArenaStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  reason: z.string().trim().min(1).max(500)
});

export const adminEventsListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
  type: z.enum(["FREE", "PAID"]).optional(),
  organizerId: z.string().uuid().optional(),
  city: z.string().trim().max(100).optional()
});

export const patchEventStatusSchema = z.object({
  status: z.literal("CANCELLED"),
  reason: z.string().trim().min(1).max(500)
});

export const adminReservationsListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "CONSUMED"]).optional(),
  organizerId: z.string().uuid().optional(),
  type: z.enum(["SINGLE", "RECURRING"]).optional()
});

export const adminBookingsListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["RESERVED", "EXPIRED", "CANCELLED", "COMPLETED"]).optional(),
  userId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional()
});

export const adminPaymentsListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "PAID", "FAILED", "CANCELLED"]).optional(),
  userId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  reservationId: z.string().uuid().optional()
});

export const adminAuditLogsListQuerySchema = paginationQuerySchema.extend({
  actorUserId: z.string().uuid().optional(),
  resourceType: z.enum(["USER", "ARENA", "EVENT"]).optional(),
  action: z.string().trim().max(100).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional()
});
