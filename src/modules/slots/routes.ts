import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireSpaceManageAccess } from "../../shared/middleware/require-arena-access";
import { createSlotSchema, listSlotsQuerySchema } from "./schemas";
import { createSlot, listSlotsBySpace } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function slotsRoutes(deps: AppDeps) {
  const router = Router();

  router.get("/spaces/:spaceId/slots", async (req, res, next) => {
    try {
      const parsed = listSlotsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listSlotsBySpace(deps.pool, req.params.spaceId, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/spaces/:spaceId/slots",
    requireAuth(deps),
    requireSpaceManageAccess(deps),
    async (req, res, next) => {
      try {
        const parsed = createSlotSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const created = await createSlot(deps.pool, req.params.spaceId, parsed.data);
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
