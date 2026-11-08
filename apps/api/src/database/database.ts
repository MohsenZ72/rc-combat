import type pg from "pg";

export type Queryable = Pick<pg.PoolClient, "query">;

/** Thin wrapper over the pg pool: parameterised queries and transactions only. */
export class Database {
  constructor(private readonly pool: pg.Pool) {}

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  /** Runs `fn` in a transaction; rolls back on any error. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
