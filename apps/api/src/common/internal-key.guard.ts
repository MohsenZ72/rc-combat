import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { ENV, type Env } from "../config/env.js";

/**
 * Protects /internal routes (game server → API). Constant-time comparison of
 * the shared key; these routes must also be firewalled from the internet.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.expected = Buffer.from(env.INTERNAL_API_KEY);
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers["x-internal-key"];
    const given = Buffer.from(typeof header === "string" ? header : "");
    if (given.length !== this.expected.length || !timingSafeEqual(given, this.expected)) {
      throw new UnauthorizedException({ error: "invalid_internal_key" });
    }
    return true;
  }
}
