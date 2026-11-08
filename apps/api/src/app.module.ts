import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.js";
import { RateLimitGuard } from "./common/rate-limit.guard.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { MatchesModule } from "./matches/matches.module.js";
import { PlayersModule } from "./players/players.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    MatchesModule,
    PlayersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
