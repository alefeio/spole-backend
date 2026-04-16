import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("deve responder com envelope de sucesso", async () => {
    const app = createApp();

    const res = await request(app).get("/health").expect(200);

    expect(res.body).toMatchObject({
      success: true,
      data: { status: "ok" }
    });
    expect(res.body.meta?.uptimeMs).toBeTypeOf("number");
  });
});
