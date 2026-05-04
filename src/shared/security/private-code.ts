import { randomBytes, timingSafeEqual } from "node:crypto";

/** Código opaco para acesso a evento privado (mín. 8 caracteres). */
export function generatePrivateEventCode(): string {
  return randomBytes(9).toString("base64url");
}

export function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
