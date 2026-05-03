import type { NextFunction, Request, Response } from "express";
import { sendFailure } from "../../http/api-response";
import type { UserRole } from "../../types/auth";

export function requireRoles(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (!role) {
      return sendFailure(res, 401, "UNAUTHORIZED", "Unauthorized");
    }

    if (!roles.includes(role)) {
      return sendFailure(res, 403, "FORBIDDEN", "Forbidden");
    }

    return next();
  };
}
