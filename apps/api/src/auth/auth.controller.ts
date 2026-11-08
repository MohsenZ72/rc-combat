import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { guestLoginSchema } from "@rc/shared";
import { CurrentPlayer, PlayerAuthGuard } from "../common/player-auth.guard.js";
import { RateLimit } from "../common/rate-limit.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AuthService, type AuthedPlayer } from "./auth.service.js";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Creates a guest account + session. Wallet sign-in (SIWE) replaces this in phase 2. */
  @Post("guest")
  @RateLimit(Number(process.env.GUEST_LOGINS_PER_MINUTE ?? 10))
  guest(@Body(new ZodPipe(guestLoginSchema)) body: { nickname: string }) {
    return this.auth.guestLogin(body.nickname);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(PlayerAuthGuard)
  async logout(@CurrentPlayer() player: AuthedPlayer): Promise<void> {
    await this.auth.logout(player.sessionId);
  }
}
