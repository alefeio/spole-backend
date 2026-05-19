import { Router } from "express";
import type { ZodError } from "zod";
import type { AppDeps } from "../../app";
import { sendFailure, sendSuccess } from "../../http/api-response";
import { optionalAuth } from "../../shared/middleware/optional-auth";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { bumpPublicCatalogVersion } from "../../shared/cache/public-catalog-cache";
import { listEventsQuerySchema, parseCreateEventBody, patchEventSchema } from "./schemas";
import { buildRateLimiters } from "../../shared/security/rate-limit-profiles";
import { cancelEvent, createEvent, getEventDetail, listPublicEvents, updateEvent } from "./service";

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message
  }));
}

export function eventsRoutes(deps: AppDeps) {
  const router = Router();
  const rateLimit = buildRateLimiters(deps);

  router.get("/events", rateLimit.publicEvents, async (req, res, next) => {
    try {
      const parsed = listEventsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid query", formatZodError(parsed.error));
      }
      const { data, meta } = await listPublicEvents(deps, parsed.data);
      return sendSuccess(res, data, meta);
    } catch (err) {
      next(err);
    }
  });

  router.get("/events/:id", optionalAuth(deps), async (req, res, next) => {
    try {
      const raw = req.query.privateCode;
      const privateCode = typeof raw === "string" ? raw : undefined;
      const detail = await getEventDetail(deps.pool, req.params.id, req.auth, privateCode);
      return sendSuccess(res, detail);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/events",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = parseCreateEventBody(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const created = await createEvent(deps.pool, req.auth!.id, parsed.data);
        await bumpPublicCatalogVersion(deps.redis);
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    "/events/:id",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const parsed = patchEventSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendFailure(res, 400, "VALIDATION_ERROR", "Invalid request", formatZodError(parsed.error));
        }
        const updated = await updateEvent(deps.pool, req.params.id, req.auth!, parsed.data);
        await bumpPublicCatalogVersion(deps.redis);
        return sendSuccess(res, updated);
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete(
    "/events/:id",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const result = await cancelEvent(deps.pool, req.params.id, req.auth!);
        await bumpPublicCatalogVersion(deps.redis);
        return sendSuccess(res, result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
