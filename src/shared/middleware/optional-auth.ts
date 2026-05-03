import type { NextFunction, Request, Response } from "express";
import type { AppDeps } from "../../app";
import { verifyAccessToken } from "../config/jwt";
import type { AuthUser } from "../../types/auth";

/**
 * Preenche `req.auth` quando há Bearer válido; segue sem autenticação se o header estiver ausente
 * ou o token for inválido (rotas públicas continuam acessíveis).
 */
export function optionalAuth(deps: AppDeps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header?.toLowerCase().startsWith("bearer ")) {
      return next();
    }

    const token = header.slice("bearer ".length).trim();
    if (!token) {
      return next();
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
      if (!user || user.role !== claims.role || user.status !== claims.status) {
        return next();
      }

      if (user.status === "SUSPENDED") {
        return next();
      }

      req.auth = { id: user.id, role: user.role, status: user.status };
      return next();
    } catch {
      return next();
    }
  };
}
