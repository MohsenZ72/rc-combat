import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { matchOutcomeSchema, matchStartSchema, type MatchOutcome, type MatchStartPayload } from "@rc/shared";
import { z } from "zod";
import { AuthService } from "../auth/auth.service.js";
import { ENV, type Env } from "../config/env.js";
import { InternalKeyGuard } from "../common/internal-key.guard.js";
import { SkipRateLimit } from "../common/rate-limit.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { MatchesRepository } from "./matches.repository.js";
import { MatchesService } from "./matches.service.js";

const sessionCheckSchema = z.object({ sessionId: z.string().max(64), playerId: z.string().max(64) });
const resultSchema = z.object({ outcome: matchOutcomeSchema, replayGz: z.string().max(9_000_000) });
const testGuestsSchema = z.object({ count: z.number().int().min(1).max(500), prefix: z.string().max(8).default("load") });

/**
 * Server-to-server routes for game servers. Guarded by the internal key and
 * meant to be reachable only on the private network.
 */
@Controller("internal")
@UseGuards(InternalKeyGuard)
@SkipRateLimit()
export class InternalController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MatchesService) private readonly matches: MatchesService,
    @Inject(MatchesRepository) private readonly repo: MatchesRepository,
  ) {}

  @Post("sessions/validate")
  @HttpCode(200)
  async validateSession(@Body(new ZodPipe(sessionCheckSchema)) body: z.infer<typeof sessionCheckSchema>) {
    const info = await this.auth.validateSession(body.sessionId, body.playerId);
    if (!info) throw new NotFoundException({ error: "no_session" });
    return info;
  }

  @Post("matches")
  @HttpCode(200)
  startMatch(@Body(new ZodPipe(matchStartSchema)) body: MatchStartPayload) {
    return this.matches.start(body);
  }

  @Post("matches/:id/result")
  @HttpCode(200)
  finishMatch(@Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(resultSchema)) body: { outcome: MatchOutcome; replayGz: string }) {
    return this.matches.finish(id, body.outcome, body.replayGz);
  }

  @Post("servers/:serverId/boot")
  @HttpCode(200)
  serverBooted(@Param("serverId") serverId: string) {
    return this.matches.serverBooted(serverId.slice(0, 64));
  }

  @Get("review-queue")
  reviewQueue(@Query("limit") limit?: string) {
    return this.repo.reviewQueue(Math.min(200, Math.max(1, Number(limit) || 50)));
  }

  @Get("matches/:id/replay")
  async replay(@Param("id", new ParseUUIDPipe()) id: string) {
    const data = await this.repo.replay(id);
    if (!data) throw new NotFoundException({ error: "no_replay" });
    return { matchId: id, format: "json+gzip", replayGz: data.toString("base64") };
  }

  /** Bulk guest accounts for load tests. Disabled in production. */
  @Post("test/guests")
  @HttpCode(200)
  async testGuests(@Body(new ZodPipe(testGuestsSchema)) body: z.infer<typeof testGuestsSchema>) {
    if (this.env.NODE_ENV === "production") throw new ForbiddenException({ error: "disabled_in_production" });
    const out = [];
    for (let i = 0; i < body.count; i++) out.push(await this.auth.guestLogin(`${body.prefix}${String(i).padStart(4, "0")}`));
    return out;
  }
}
