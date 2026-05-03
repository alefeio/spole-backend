import { Router } from "express";
import type { AppDeps } from "../../app";
import { sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { getMe } from "./service";

export function usersRoutes(deps: AppDeps) {
  const router = Router();

  router.get(
    "/users/me",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const auth = req.auth!;
        const user = await getMe(deps.pool, auth.id);
        return sendSuccess(res, {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
