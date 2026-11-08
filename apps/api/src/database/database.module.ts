import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import pg from "pg";
import { ENV, type Env } from "../config/env.js";
import { Database } from "./database.js";

export const PG_POOL = Symbol("PG_POOL");

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new pg.Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }),
    },
    { provide: Database, inject: [PG_POOL], useFactory: (pool: pg.Pool) => new Database(pool) },
  ],
  exports: [Database, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
