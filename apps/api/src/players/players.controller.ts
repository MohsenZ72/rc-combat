import { Body, Controller, Get, Inject, Put, Query, UseGuards } from "@nestjs/common";
import { cosmeticsSchema, type Cosmetics } from "@rc/shared";
import { AuthService } from "../auth/auth.service.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { AuthedPlayer } from "../auth/auth.service.js";
import { CurrentPlayer, PlayerAuthGuard } from "../common/player-auth.guard.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { PlayersRepository } from "./players.repository.js";

@Controller("players")
@UseGuards(PlayerAuthGuard)
export class PlayersController {
  constructor(
    @Inject(PlayersRepository) private readonly players: PlayersRepository,
    @Inject(MatchesRepository) private readonly matches: MatchesRepository,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Current car loadout (a stable random one until the player saves their own). */
  @Get("me/cosmetics")
  async cosmetics(@CurrentPlayer() player: AuthedPlayer) {
    const info = await this.auth.validateSession(player.sessionId, player.playerId);
    return info?.cosmetics;
  }

  /** Saves a loadout. Only ids from the shared whitelist pass; cosmetics never touch gameplay. */
  @Put("me/cosmetics")
  async saveCosmetics(@CurrentPlayer() player: AuthedPlayer, @Body(new ZodPipe(cosmeticsSchema)) body: Cosmetics) {
    await this.players.setCosmetics(player.playerId, body);
    return body;
  }

  @Get("me")
  async me(@CurrentPlayer() player: AuthedPlayer) {
    const row = await this.players.findById(player.playerId);
    const stats = await this.players.stats(player.playerId);
    return { id: player.playerId, nickname: row?.nickname ?? player.nickname, createdAt: row?.created_at, stats };
  }

  @Get("me/matches")
  myMatches(@CurrentPlayer() player: AuthedPlayer, @Query("limit") limit?: string) {
    return this.matches.forPlayer(player.playerId, Math.min(50, Math.max(1, Number(limit) || 20)));
  }
}
