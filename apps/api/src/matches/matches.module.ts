import { Module } from "@nestjs/common";
import { AnticheatService } from "../anticheat/anticheat.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { InternalKeyGuard } from "../common/internal-key.guard.js";
import { FreeMatchSettlement, PRIZE_SETTLEMENT } from "../tournaments/settlement.js";
import { InternalController } from "./internal.controller.js";
import { MatchesController } from "./matches.controller.js";
import { MatchesRepository } from "./matches.repository.js";
import { MatchesService } from "./matches.service.js";

@Module({
  imports: [AuthModule],
  controllers: [InternalController, MatchesController],
  providers: [
    MatchesRepository,
    MatchesService,
    AnticheatService,
    InternalKeyGuard,
    // Swap for an escrow adapter when paid tournaments ship.
    { provide: PRIZE_SETTLEMENT, useClass: FreeMatchSettlement },
  ],
  exports: [MatchesRepository],
})
export class MatchesModule {}
