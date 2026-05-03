import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { loginUser, registerUser } from "./service";
import { loginSchema, registerSchema } from "./schemas";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function authRoutes(deps: AppDeps) {
  const router = Router();

  router.post("/auth/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendFailure(
          res,
          400,
          "VALIDATION_ERROR",
          "Invalid request",
          formatZodError(parsed.error)
        );
      }

      const user = await registerUser(deps.pool, parsed.data);
      return sendSuccess(
        res,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        undefined,
        201
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendFailure(
          res,
          400,
          "VALIDATION_ERROR",
          "Invalid request",
          formatZodError(parsed.error)
        );
      }

      const result = await loginUser(deps.pool, deps.env, parsed.data);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
