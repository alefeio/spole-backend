import type { Pool } from "pg";
import { AppError } from "../../shared/errors/app-error";
import type { UserRole, UserStatus } from "../../types/auth";

export async function getMe(pool: Pool, userId: string) {
  const res = await pool.query<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    status: UserStatus;
  }>(
    `
      SELECT id, name, email, role, status
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  const user = res.rows[0];
  if (!user) {
    throw new AppError({ status: 404, code: "USER_NOT_FOUND", message: "User not found" });
  }

  return user;
}
