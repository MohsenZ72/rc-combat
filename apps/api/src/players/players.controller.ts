import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
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
  ) {}

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
