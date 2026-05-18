import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { bumpPublicCatalogVersion } from "../../shared/cache/public-catalog-cache";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import {
  adminArenasListQuerySchema,
  adminAuditLogsListQuerySchema,
  adminBookingsListQuerySchema,
  adminEventsListQuerySchema,
  adminPaymentsListQuerySchema,
  adminReservationsListQuerySchema,
  adminUsersListQuerySchema,
  patchArenaStatusSchema,
  patchEventStatusSchema,
  patchUserStatusSchema
} from "./schemas";
import {
  getAdminUserById,
  listAdminArenas,
  listAdminAuditLogs,
  listAdminBookings,
  listAdminEvents,
  listAdminPayments,
  listAdminReservations,
  listAdminUsers,
  patchAdminArenaStatus,
  patchAdminEventStatus,
  patchAdminUserStatus
} from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

function adminOnly(deps: AppDeps) {
  return [requireAuth(deps), requireRoles(["admin"])] as const;
}

export function adminRoutes(deps: AppDeps) {
  const router = Router();

  router.get("/admin/users", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminUsersListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminUsers(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/users/:id", ...adminOnly(deps), async (req, res, next) => {
    try {
      const data = await getAdminUserById(deps.pool, req.params.id);
      return sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/users/:id/status", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = patchUserStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
      }
      const data = await patchAdminUserStatus(deps.pool, req.auth!, req.params.id, parsed.data);
      return sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/arenas", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminArenasListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminArenas(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/arenas/:id/status", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = patchArenaStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
      }
      const data = await patchAdminArenaStatus(deps.pool, req.auth!, req.params.id, parsed.data);
      return sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/events", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminEventsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminEvents(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/events/:id/status", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = patchEventStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
      }
      const data = await patchAdminEventStatus(deps, req.auth!, req.params.id, parsed.data);
      await bumpPublicCatalogVersion(deps.redis);
      return sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/reservations", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminReservationsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminReservations(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/bookings", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminBookingsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminBookings(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/payments", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminPaymentsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminPayments(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/audit-logs", ...adminOnly(deps), async (req, res, next) => {
    try {
      const parsed = adminAuditLogsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listAdminAuditLogs(deps.pool, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
