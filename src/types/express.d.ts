import type { Pool } from "pg";
import type { AuthUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
      pg?: Pool;
      requestId?: string;
    }
  }
}

export {};
