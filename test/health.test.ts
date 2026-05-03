import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./test-deps";
import { resetHealth, setPostgresHealthy, setRedisHealthy } from "../src/shared/health/health";

describe("GET /health", () => {
  beforeEach(() => {
    resetHealth();
  });

  it("deve responder 200 quando consistente", async () => {
    setPostgresHealthy(true);
    setRedisHealthy(true);

    const app = createTestApp();

    const res = await request(app).get("/health").expect(200);

    expect(res.body).toMatchObject({
      success: true,
      data: { status: "ok" }
    });
  });

  it("deve responder 500 quando inconsistente", async () => {
    setPostgresHealthy(true);
    setRedisHealthy(false);

    const app = createTestApp();

    const res = await request(app).get("/health").expect(500);

    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: "DEPENDENCY_INCONSISTENT"
      }
    });
  });
});
