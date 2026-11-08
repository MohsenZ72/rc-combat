import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { SkipRateLimit } from "../common/rate-limit.guard.js";
import { Database } from "../database/database.js";

@Controller("health")
@SkipRateLimit()
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get()
  async check() {
    try {
      await this.db.query("SELECT 1");
      return { ok: true, db: "up" };
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: "down" });
    }
  }
}
