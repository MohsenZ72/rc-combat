import { HttpException, HttpStatus, Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { ENV, type Env } from "../config/env.js";

const RATE_LIMIT = "rc:rate-limit";

interface Rule {
  limit: number;
  windowMs: number;
}

/** Per-route limit (requests per window per client IP). */
export const RateLimit = (limit: number, windowMs = 60_000) => SetMetadata(RATE_LIMIT, { limit, windowMs } satisfies Rule);
/** Exempts a controller/route (e.g. key-guarded internal routes). */
export const SkipRateLimit = () => SetMetadata(RATE_LIMIT, null);

/**
 * Fixed-window, in-memory rate limiter keyed by IP + route. Good for a
 * single API instance; with several instances put the counters in Redis
 * (see docs/runbook.md) or rate-limit at the load balancer.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<Rule | null | undefined>(RATE_LIMIT, [context.getHandler(), context.getClass()]);
    if (rule === null) return true;
    const { limit, windowMs } = rule ?? { limit: this.env.RATE_LIMIT_PER_MINUTE, windowMs: 60_000 };
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const now = Date.now();
    this.sweep(now);
    const key = `${req.ip ?? "?"}|${context.getClass().name}.${context.getHandler().name}`;
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    const res = http.getResponse<Response>();
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
