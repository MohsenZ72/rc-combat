import { Module } from "@nestjs/common";
import { PlayerAuthGuard } from "../common/player-auth.guard.js";
import { PlayersRepository } from "../players/players.repository.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionsRepository } from "./sessions.repository.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionsRepository, PlayersRepository, PlayerAuthGuard],
  exports: [AuthService, PlayersRepository, PlayerAuthGuard],
})
export class AuthModule {}
