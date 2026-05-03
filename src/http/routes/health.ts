import { Router } from "express";
import { sendFailure, sendSuccess } from "../api-response";
import { getHealthSnapshot, isHealthy } from "../../shared/health/health";

export function healthRoutes() {
  const router = Router();

  router.get("/health", (_req, res) => {
    if (!isHealthy()) {
      const snapshot = getHealthSnapshot();
      return sendFailure(res, 500, "DEPENDENCY_INCONSISTENT", "Application is inconsistent", [
        snapshot
      ]);
    }

    return sendSuccess(res, { status: "ok" });
  });

  return router;
}
