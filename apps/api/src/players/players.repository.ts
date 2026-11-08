import { Inject, Injectable } from "@nestjs/common";
import type { Cosmetics } from "@rc/shared";
import { Database, type Queryable } from "../database/database.js";

export interface PlayerRow {
  id: string;
  nickname: string;
  status: "active" | "suspended" | "banned";
  suspended_until: Date | null;
  created_at: Date;
  cosmetics: unknown;
}

export interface PlayerStats {
  matches: number;
  wins: number;
  podiums: number;
  best_finish_ms: number | null;
}

@Injectable()
export class PlayersRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  async create(nickname: string): Promise<PlayerRow> {
    const { rows } = await this.db.query<PlayerRow>(
      "INSERT INTO players (nickname) VALUES ($1) RETURNING id, nickname, status, suspended_until, created_at, cosmetics",
      [nickname],
    );
    return rows[0]!;
  }

  async findById(id: string): Promise<PlayerRow | null> {
    const { rows } = await this.db.query<PlayerRow>("SELECT id, nickname, status, suspended_until, created_at, cosmetics FROM players WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  /** Lifts suspensions whose end time has passed. Returns the current row. */
  async refreshStatus(id: string): Promise<PlayerRow | null> {
    const { rows } = await this.db.query<PlayerRow>(
      `UPDATE players SET status = 'active', suspended_until = NULL
         WHERE id = $1 AND status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until <= now()
       RETURNING id, nickname, status, suspended_until, created_at, cosmetics`,
      [id],
    );
    return rows[0] ?? this.findById(id);
  }

  async suspend(tx: Queryable, playerId: string, until: Date, reason: string, matchId: string): Promise<void> {
    await tx.query(
      `UPDATE players SET status = 'suspended', suspended_until = GREATEST(COALESCE(suspended_until, $2), $2)
         WHERE id = $1 AND status <> 'banned'`,
      [playerId, until],
    );
    await tx.query("INSERT INTO sanctions (player_id, kind, reason, match_id, ends_at) VALUES ($1, 'temporary_suspension', $2, $3, $4)", [
      playerId,
      reason,
      matchId,
      until,
    ]);
    // A suspended player loses every live session immediately.
    await tx.query("UPDATE sessions SET revoked_at = now() WHERE player_id = $1 AND revoked_at IS NULL", [playerId]);
  }

  /** Stores an already-validated cosmetics loadout. */
  async setCosmetics(id: string, cosmetics: Cosmetics): Promise<void> {
    await this.db.query("UPDATE players SET cosmetics = $2 WHERE id = $1", [id, JSON.stringify(cosmetics)]);
  }

  async stats(id: string): Promise<PlayerStats> {
    const { rows } = await this.db.query<PlayerStats>(
      `SELECT count(*)::int AS matches,
              count(*) FILTER (WHERE mp.rank = 1 AND mp.status = 'finished')::int AS wins,
              count(*) FILTER (WHERE mp.rank <= 3 AND mp.status = 'finished')::int AS podiums,
              min(mp.finish_time_ms) AS best_finish_ms
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
        WHERE mp.player_id = $1 AND m.status = 'finished' AND mp.verified`,
      [id],
    );
    return rows[0]!;
  }
}
