import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { Env } from "../../shared/env/env";
import { signAccessToken } from "../../shared/config/jwt";
import type { UserRole, UserStatus } from "../../types/auth";
import type { LoginInput, RegisterInput } from "./schemas";

export async function registerUser(pool: Pool, input: RegisterInput) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRes = await client.query<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
    }>(
      `
        INSERT INTO users (name, email, password_hash, phone)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, email, role
      `,
      [input.name, input.email, passwordHash, input.phone ?? null]
    );

    const user = userRes.rows[0];
    if (!user) {
      throw new AppError({
        status: 500,
        code: "USER_CREATE_FAILED",
        message: "User create failed"
      });
    }

    await client.query(
      `
        INSERT INTO user_profiles (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
      `,
      [user.id]
    );

    await client.query("COMMIT");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");

    const code = (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      throw new AppError({
        status: 409,
        code: "EMAIL_ALREADY_EXISTS",
        message: "Email already registered"
      });
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function loginUser(pool: Pool, env: Env, input: LoginInput) {
  const res = await pool.query<{
    id: string;
    name: string;
    email: string;
    password_hash: string;
    role: UserRole;
    status: UserStatus;
  }>(
    `
      SELECT id, name, email, password_hash, role, status
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [input.email]
  );

  const user = res.rows[0];
  if (!user) {
    throw new AppError({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials"
    });
  }

  if (user.status === "SUSPENDED") {
    throw new AppError({ status: 403, code: "USER_SUSPENDED", message: "User is suspended" });
  }

  const ok = await bcrypt.compare(input.password, user.password_hash);
  if (!ok) {
    throw new AppError({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials"
    });
  }

  const token = signAccessToken(env, { sub: user.id, role: user.role, status: user.status });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  };
}
