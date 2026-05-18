import { Router } from "express";
import type { AppDeps } from "../../app";
import { sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { markNotificationRead } from "./service";

export function notificationsRoutes(deps: AppDeps) {
  const router = Router();

  router.patch(
    "/notifications/:id/read",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await markNotificationRead(deps, req.auth!, req.params.id);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
