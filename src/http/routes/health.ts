import { Router } from "express";
import { sendSuccess } from "../api-response";

export function healthRoutes() {
  const router = Router();

  router.get("/health", (_req, res) => {
    return sendSuccess(res, { status: "ok" }, { uptimeMs: Math.round(process.uptime() * 1000) });
  });

  return router;
}
