import type { NextFunction, Request, Response } from "express";
import type { AppDeps } from "../../app";
import { sendFailure } from "../../http/api-response";
import { verifyAccessToken } from "../config/jwt";
import { isUserAccessBlocked } from "../auth/user-access";
import type { AuthUser } from "../../types/auth";

export function requireAuth(deps: AppDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header?.toLowerCase().startsWith("bearer ")) {
      return sendFailure(res, 401, "UNAUTHORIZED", "Missing bearer token");
    }

    const token = header.slice("bearer ".length).trim();
    if (!token) {
      return sendFailure(res, 401, "UNAUTHORIZED", "Missing bearer token");
    }

    try {
      const claims = verifyAccessToken(deps.env, token);

      const userRes = await deps.pool.query<{
        id: string;
        role: AuthUser["role"];
        status: AuthUser["status"];
      }>(
        `
          SELECT id, role, status
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [claims.sub]
      );

      const user = userRes.rows[0];
      if (!user) {
        return sendFailure(res, 401, "UNAUTHORIZED", "Invalid token");
      }

      if (isUserAccessBlocked(user.status)) {
        return sendFailure(res, 403, "USER_SUSPENDED", "User access is blocked");
      }

      if (user.role !== claims.role || user.status !== claims.status) {
        return sendFailure(res, 401, "UNAUTHORIZED", "Invalid token");
      }

      req.auth = { id: user.id, role: user.role, status: user.status };
      return next();
    } catch {
      return sendFailure(res, 401, "UNAUTHORIZED", "Invalid token");
    }
  };
}
