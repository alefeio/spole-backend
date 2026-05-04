import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createStubRedisClient } from "./test-deps";
import { createPostgresPool } from "../src/shared/db/postgres/postgres";
import { runMigrations } from "../src/shared/db/migrate";
import { loadEnv } from "../src/shared/env/env";
import { createLogger } from "../src/shared/logger/logger";

describe("auth + users (integração)", () => {
  const logger = createLogger("test");
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    const maybePool = createPostgresPool(env.postgres);

    try {
      await maybePool.query("SELECT 1");
    } catch {
      console.warn("[auth.integration] Postgres indisponível: pulando testes de integração.");
      await maybePool.end().catch(() => undefined);
      pool = undefined;
      return;
    }

    pool = maybePool;

    await runMigrations(pool, logger);
    app = createApp({ pool, env, redis: createStubRedisClient() });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("cadastro + login + /users/me + bloqueios básicos", async () => {
    if (!pool || !app) return;

    const suffix = crypto.randomUUID();
    const email = `user_${suffix}@example.com`;

    const register = await request(app)
      .post("/auth/register")
      .send({
        name: "Usuário Teste",
        email,
        password: "SenhaSegura123",
        phone: "91999999999"
      })
      .expect(201);

    expect(register.body.success).toBe(true);
    expect(register.body.data).toMatchObject({
      email,
      role: "user"
    });

    const dup = await request(app)
      .post("/auth/register")
      .send({
        name: "Outro",
        email,
        password: "SenhaSegura123"
      })
      .expect(409);

    expect(dup.body.success).toBe(false);
    expect(dup.body.error.code).toBe("EMAIL_ALREADY_EXISTS");

    const loginBad = await request(app)
      .post("/auth/login")
      .send({ email, password: "SenhaErrada123" })
      .expect(401);
    expect(loginBad.body.success).toBe(false);

    const login = await request(app)
      .post("/auth/login")
      .send({ email, password: "SenhaSegura123" })
      .expect(200);

    expect(login.body.success).toBe(true);
    const token = login.body.data.token as string;
    expect(token.length).toBeGreaterThan(10);

    const me = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data).toMatchObject({
      email,
      role: "user",
      status: "ACTIVE"
    });

    const noAuth = await request(app).get("/users/me").expect(401);
    expect(noAuth.body.success).toBe(false);

    const badToken = await request(app)
      .get("/users/me")
      .set("Authorization", "Bearer invalid")
      .expect(401);
    expect(badToken.body.success).toBe(false);

    await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE email = $1`, [email]);

    const loginSuspended = await request(app)
      .post("/auth/login")
      .send({ email, password: "SenhaSegura123" })
      .expect(403);
    expect(loginSuspended.body.success).toBe(false);
    expect(loginSuspended.body.error.code).toBe("USER_SUSPENDED");

    await pool.query(`DELETE FROM users WHERE email = $1`, [email]);
  });
});
