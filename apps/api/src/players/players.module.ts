import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MatchesModule } from "../matches/matches.module.js";
import { PlayersController } from "./players.controller.js";

@Module({
  imports: [AuthModule, MatchesModule],
  controllers: [PlayersController],
})
export class PlayersModule {}
