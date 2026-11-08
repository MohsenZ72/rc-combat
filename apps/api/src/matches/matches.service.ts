import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { MatchOutcome, MatchStartPayload } from "@rc/shared";
import { gunzipSync } from "node:zlib";
import { AnticheatService } from "../anticheat/anticheat.service.js";
import { PRIZE_SETTLEMENT, type PrizeSettlementPort } from "../tournaments/settlement.js";
import { MatchesRepository } from "./matches.repository.js";

const MAX_REPLAY_BYTES = 6 * 1024 * 1024;
const MAX_REPLAY_INFLATED = 64 * 1024 * 1024;

@Injectable()
export class MatchesService {
  private readonly log = new Logger("Matches");

  constructor(
    @Inject(MatchesRepository) private readonly repo: MatchesRepository,
    @Inject(AnticheatService) private readonly anticheat: AnticheatService,
    @Inject(PRIZE_SETTLEMENT) private readonly settlement: PrizeSettlementPort,
  ) {}

  async start(payload: MatchStartPayload): Promise<{ status: string }> {
    const status = await this.repo.register(payload);
    if (status === "conflict") throw new ConflictException({ error: "match_id_conflict" });
    return { status };
  }

  /**
   * Records a finished match. The result must match what was registered at
   * the start (same server, seed, config and roster), so a compromised or
   * misconfigured server cannot rewrite who played. Idempotent: a retry of
   * an already-recorded match is acknowledged without changes.
   */
  async finish(matchId: string, outcome: MatchOutcome, replayGz: string): Promise<{ status: string }> {
    if (outcome.matchId !== matchId) throw new BadRequestException({ error: "match_id_mismatch" });
    const replay = this.decodeReplay(replayGz);
    const result = await this.repo.database.transaction(async (tx) => {
      const match = await this.repo.findForUpdate(tx, matchId);
      if (!match) throw new NotFoundException({ error: "unknown_match" });
      if (match.status !== "running") return { status: "already_recorded" };
      if (match.server_id !== outcome.serverId) throw new ConflictException({ error: "server_mismatch" });
      if (Number(match.seed) !== outcome.seed || match.config_hash !== outcome.configHash) throw new ConflictException({ error: "match_parameters_mismatch" });
      const roster = await this.repo.roster(tx, matchId);
      this.checkRoster(roster, outcome);
      await this.repo.saveOutcome(tx, outcome);
      await this.repo.saveReplay(tx, matchId, replay);
      const ac = await this.anticheat.apply(tx, outcome);
      this.log.log({ matchId, status: outcome.status, verified: outcome.verified, ...ac }, "match recorded");
      return { status: "recorded" };
    });
    if (result.status === "recorded") {
      const instructions = await this.settlement.settle(outcome);
      if (instructions.length > 0) this.log.log({ matchId, payouts: instructions.length }, "settlement instructions produced");
    }
    return result;
  }

  serverBooted(serverId: string) {
    return this.repo.abandonRunning(serverId).then((abandoned) => ({ abandoned }));
  }

  private checkRoster(roster: { slot: number; player_id: string | null; is_bot: boolean }[], outcome: MatchOutcome): void {
    if (roster.length !== outcome.results.length) throw new ConflictException({ error: "roster_mismatch" });
    const bySlot = new Map(roster.map((r) => [r.slot, r]));
    const ranks = new Set<number>();
    for (const r of outcome.results) {
      const seat = bySlot.get(r.slot);
      if (!seat || seat.player_id !== r.playerId || seat.is_bot !== r.isBot) throw new ConflictException({ error: "roster_mismatch", slot: r.slot });
      if (ranks.has(r.rank) || r.rank > roster.length) throw new BadRequestException({ error: "invalid_ranks" });
      ranks.add(r.rank);
    }
  }

  /** Replays arrive gzipped + base64; check size and integrity before storing. */
  private decodeReplay(b64: string): Buffer {
    const data = Buffer.from(b64, "base64");
    if (data.byteLength === 0 || data.byteLength > MAX_REPLAY_BYTES) throw new BadRequestException({ error: "replay_size" });
    if (data[0] !== 0x1f || data[1] !== 0x8b) throw new BadRequestException({ error: "replay_not_gzip" });
    try {
      gunzipSync(data, { maxOutputLength: MAX_REPLAY_INFLATED });
    } catch {
      throw new BadRequestException({ error: "replay_corrupt" });
    }
    return data;
  }
}
