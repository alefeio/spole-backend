import { Router } from "express";
import type { AppDeps } from "../../app";
import { sendSuccess } from "../../http/api-response";
import { requireAuth } from "../../shared/middleware/require-auth";
import { requireRoles } from "../../shared/middleware/require-roles";
import { joinFreeEvent, listEventParticipants } from "./service";

export function eventParticipantsRoutes(deps: AppDeps) {
  const router = Router();

  router.post(
    "/events/:eventId/participants/free",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const raw = req.query.privateCode;
        const privateCode = typeof raw === "string" ? raw : undefined;
        const created = await joinFreeEvent(deps, req.auth!, req.params.eventId, privateCode);
        return sendSuccess(res, created, undefined, 201);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/events/:eventId/participants",
    requireAuth(deps),
    requireRoles(["user", "arena_owner", "admin"]),
    async (req, res, next) => {
      try {
        const data = await listEventParticipants(deps, req.params.eventId, req.auth!);
        return sendSuccess(res, data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
