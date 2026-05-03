export type UserRole = "user" | "arena_owner" | "admin";
export type UserStatus = "ACTIVE" | "SUSPENDED";

export type AuthUser = {
  id: string;
  role: UserRole;
  status: UserStatus;
};
