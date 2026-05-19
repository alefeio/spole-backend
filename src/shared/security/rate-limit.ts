import type { NextFunction, Request, Response } from "express";
import type { AppDeps } from "../../app";
import { sendFailure } from "../../http/api-response";
import { createLogger } from "../logger/logger";
import type { RedisAppClient } from "../cache/redis/redis";

const log = createLogger("rate-limit");

export type RateLimitProfile = "auth" | "publicRead" | "authenticated";

export type RateLimitConfig = {
  windowSeconds: number;
  maxRequests: number;
};

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.ip || "unknown";
}

function redisKey(profile: RateLimitProfile, identity: string, route: string): string {
  return `spole:rl:${profile}:${identity}:${route}`;
}

async function incrementCounter(
  redis: RedisAppClient,
  key: string,
  windowSeconds: number
): Promise<number | null> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count;
}

export function createRateLimitMiddleware(
  deps: AppDeps,
  profile: RateLimitProfile,
  routeKey: string,
  config: RateLimitConfig
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let identity: string;
    if (profile === "authenticated") {
      if (!req.auth?.id) {
        return next();
      }
      identity = req.auth.id;
    } else {
      identity = clientIp(req);
    }

    const key = redisKey(profile, identity, routeKey);

    try {
      const count = await incrementCounter(deps.redis, key, config.windowSeconds);
      if (count === null) {
        return next();
      }

      const remaining = Math.max(0, config.maxRequests - count);
      res.setHeader("X-RateLimit-Limit", String(config.maxRequests));
      res.setHeader("X-RateLimit-Remaining", String(remaining));

      if (count > config.maxRequests) {
        res.setHeader("Retry-After", String(config.windowSeconds));
        return sendFailure(res, 429, "RATE_LIMIT_EXCEEDED", "Too many requests");
      }

      return next();
    } catch (err) {
      log.warn("rate limit skipped redis unavailable", {
        profile,
        route: routeKey,
        message: err instanceof Error ? err.message : String(err)
      });
      return next();
    }
  };
}
