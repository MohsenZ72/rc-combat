import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { MatchesRepository } from "./matches.repository.js";

/** Public, read-only match data. Never exposes anomaly details or telemetry. */
@Controller()
export class MatchesController {
  constructor(@Inject(MatchesRepository) private readonly repo: MatchesRepository) {}

  @Get("matches/:id")
  async get(@Param("id", new ParseUUIDPipe()) id: string) {
    const match = await this.repo.publicMatch(id);
    if (!match) throw new NotFoundException({ error: "unknown_match" });
    return match;
  }

  @Get("leaderboard")
  leaderboard(@Query("limit") limit?: string) {
    return this.repo.leaderboard(Math.min(100, Math.max(1, Number(limit) || 20)));
  }
}
