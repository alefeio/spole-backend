import jwt, { type SignOptions } from "jsonwebtoken";
import type { Env } from "../env/env";
import type { UserRole, UserStatus } from "../../types/auth";

export type JwtClaims = {
  sub: string;
  role: UserRole;
  status: UserStatus;
};

export function signAccessToken(env: Env, claims: JwtClaims) {
  const options: SignOptions = {
    subject: claims.sub,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    expiresIn: env.jwt.expiresIn as SignOptions["expiresIn"]
  };

  return jwt.sign(
    {
      role: claims.role,
      status: claims.status
    },
    env.jwt.secret,
    options
  );
}

export function verifyAccessToken(env: Env, token: string): JwtClaims {
  const decoded = jwt.verify(token, env.jwt.secret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience
  });

  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }

  const sub = decoded.sub;
  const role = decoded.role;
  const status = decoded.status;

  if (!sub || typeof sub !== "string") throw new Error("Invalid token subject");
  if (role !== "user" && role !== "arena_owner" && role !== "admin") {
    throw new Error("Invalid token role");
  }
  if (status !== "ACTIVE" && status !== "SUSPENDED") {
    throw new Error("Invalid token status");
  }

  return { sub, role, status };
}
