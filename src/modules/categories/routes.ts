import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { createCategorySchema, patchCategorySchema } from "./schemas";
import { createCategory, deleteCategory, listCategories, updateCategory } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function categoriesRoutes(deps: AppDeps) {
  const router = Router();

  router.get("/categories", async (_req, res, next) => {
    try {
      const rows = await listCategories(deps.pool);
      return sendSuccess(res, rows);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/categories",
    requireAuth(deps),
    requireRoles(["admin"]),
    async (req, res, next) => {
      try {
        const parsed = createCategorySchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const row = await createCategory(deps.pool, parsed.data);
        return sendSuccess(res, row, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    "/categories/:id",
    requireAuth(deps),
    requireRoles(["admin"]),
    async (req, res, next) => {
      try {
        const parsed = patchCategorySchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const row = await updateCategory(deps.pool, req.params.id, parsed.data);
        return sendSuccess(res, row);
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete(
    "/categories/:id",
    requireAuth(deps),
    requireRoles(["admin"]),
    async (req, res, next) => {
      try {
        await deleteCategory(deps.pool, req.params.id);
        return sendSuccess(res, { id: req.params.id, deleted: true });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
