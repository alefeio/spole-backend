import type { UserStatus } from "../../types/auth";

export function isUserAccessBlocked(status: UserStatus): boolean {
  return status === "SUSPENDED" || status === "INACTIVE";
}
