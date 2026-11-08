import { createParamDecorator, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, type AuthedPlayer } from "../auth/auth.service.js";

type AuthedRequest = Request & { player?: AuthedPlayer };

/** Bearer-token guard for player-facing routes; checks signature and live session. */
@Injectable()
export class PlayerAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const player = await this.auth.authenticate(token);
    if (!player) throw new UnauthorizedException({ error: "invalid_session" });
    req.player = player;
    return true;
  }
}

export const CurrentPlayer = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthedPlayer => {
  const player = ctx.switchToHttp().getRequest<AuthedRequest>().player;
  if (!player) throw new UnauthorizedException({ error: "invalid_session" });
  return player;
});
