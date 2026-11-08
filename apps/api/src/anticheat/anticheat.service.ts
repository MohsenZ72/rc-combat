import { Inject, Injectable, Logger } from "@nestjs/common";
import type { MatchOutcome, SuspicionLevel } from "@rc/shared";
import { ENV, type Env } from "../config/env.js";
import type { Queryable } from "../database/database.js";
import { PlayersRepository } from "../players/players.repository.js";

const ORDER: SuspicionLevel[] = ["normal", "suspicious", "flagged", "restricted", "match_invalidated", "temporary_suspension"];
const atLeast = (level: SuspicionLevel, min: SuspicionLevel) => ORDER.indexOf(level) >= ORDER.indexOf(min);

/**
 * Turns the game server's per-player verdicts into persistent consequences:
 * a review-queue entry for anyone flagged or worse, and an automatic
 * temporary suspension at the top level. Permanent bans are only ever
 * manual (after review), never automatic.
 */
@Injectable()
export class AnticheatService {
  private readonly log = new Logger("Anticheat");

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PlayersRepository) private readonly players: PlayersRepository,
  ) {}

  async apply(tx: Queryable, outcome: MatchOutcome): Promise<{ queued: number; suspended: number }> {
    let queued = 0;
    let suspended = 0;
    for (const r of outcome.results) {
      if (r.isBot || !r.playerId) continue;
      if (atLeast(r.suspicionLevel, "flagged")) {
        await tx.query("INSERT INTO review_queue (match_id, player_id, level, score) VALUES ($1, $2, $3, $4)", [
          outcome.matchId,
          r.playerId,
          r.suspicionLevel,
          r.suspicionScore,
        ]);
        queued++;
      }
      if (atLeast(r.suspicionLevel, "temporary_suspension")) {
        const until = new Date(Date.now() + this.env.SUSPENSION_HOURS * 3600 * 1000);
        await this.players.suspend(tx, r.playerId, until, `anti-cheat score ${r.suspicionScore}`, outcome.matchId);
        suspended++;
        this.log.warn({ playerId: r.playerId, matchId: outcome.matchId, score: r.suspicionScore }, "player temporarily suspended");
      }
    }
    return { queued, suspended };
  }
}
