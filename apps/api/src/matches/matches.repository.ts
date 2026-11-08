import { Inject, Injectable } from "@nestjs/common";
import type { MatchOutcome, MatchStartPayload } from "@rc/shared";
import { Database, type Queryable } from "../database/database.js";

export interface MatchRow {
  id: string;
  server_id: string;
  track_id: string;
  seed: string;
  config_hash: string;
  status: string;
  verified: boolean;
  end_reason: string | null;
  started_at: Date;
  ended_at: Date | null;
}

export interface RosterRow {
  slot: number;
  player_id: string | null;
  is_bot: boolean;
}

@Injectable()
export class MatchesRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  get database(): Database {
    return this.db;
  }

  /** Registers a match at countdown. Idempotent for retries from the same server. */
  async register(p: MatchStartPayload): Promise<"created" | "exists" | "conflict"> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO matches (id, server_id, track_id, seed, config_hash) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [p.matchId, p.serverId, p.trackId, p.seed, p.configHash],
      );
      if (inserted.rowCount === 0) {
        const { rows } = await tx.query<MatchRow>("SELECT * FROM matches WHERE id = $1", [p.matchId]);
        return rows[0]?.server_id === p.serverId ? "exists" : "conflict";
      }
      for (const pl of p.players) {
        await tx.query("INSERT INTO match_players (match_id, slot, player_id, nickname, is_bot) VALUES ($1, $2, $3, $4, $5)", [
          p.matchId,
          pl.slot,
          pl.playerId,
          pl.nickname,
          pl.isBot,
        ]);
      }
      return "created";
    });
  }

  async findForUpdate(tx: Queryable, id: string): Promise<MatchRow | null> {
    const { rows } = await tx.query<MatchRow>("SELECT * FROM matches WHERE id = $1 FOR UPDATE", [id]);
    return rows[0] ?? null;
  }

  async roster(tx: Queryable, matchId: string): Promise<RosterRow[]> {
    const { rows } = await tx.query<RosterRow>("SELECT slot, player_id, is_bot FROM match_players WHERE match_id = $1 ORDER BY slot", [matchId]);
    return rows;
  }

  async saveOutcome(tx: Queryable, o: MatchOutcome): Promise<void> {
    await tx.query("UPDATE matches SET status = $2, verified = $3, end_reason = $4, started_at = $5, ended_at = $6 WHERE id = $1", [
      o.matchId,
      o.status,
      o.verified,
      o.endReason,
      o.startedAt,
      o.endedAt,
    ]);
    for (const r of o.results) {
      await tx.query(
        `UPDATE match_players
            SET rank = $3, status = $4, finish_time_ms = $5, laps_completed = $6, progress = $7,
                suspicion_score = $8, suspicion_level = $9, verified = $10, telemetry = $11
          WHERE match_id = $1 AND slot = $2`,
        [o.matchId, r.slot, r.rank, r.status, r.finishTimeMs, r.lapsCompleted, r.progress, r.suspicionScore, r.suspicionLevel, r.verified, JSON.stringify(r.telemetry)],
      );
      for (const a of r.anomalies) {
        await tx.query(
          "INSERT INTO anticheat_flags (match_id, slot, player_id, tick, kind, points, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [o.matchId, r.slot, r.playerId, a.tick, a.kind, a.points, a.detail],
        );
      }
    }
  }

  async saveReplay(tx: Queryable, matchId: string, data: Buffer): Promise<void> {
    await tx.query(
      `INSERT INTO replays (match_id, size_bytes, data) VALUES ($1, $2, $3)
       ON CONFLICT (match_id) DO UPDATE SET size_bytes = EXCLUDED.size_bytes, data = EXCLUDED.data`,
      [matchId, data.byteLength, data],
    );
  }

  /** On game-server boot: anything it was running is gone. */
  async abandonRunning(serverId: string): Promise<number> {
    const res = await this.db.query(
      "UPDATE matches SET status = 'abandoned', verified = false, end_reason = 'server_restart', ended_at = now() WHERE server_id = $1 AND status = 'running'",
      [serverId],
    );
    return res.rowCount ?? 0;
  }

  async publicMatch(id: string) {
    const match = await this.db.query<MatchRow>(
      "SELECT id, track_id, status, verified, end_reason, started_at, ended_at FROM matches WHERE id = $1",
      [id],
    );
    if (!match.rows[0]) return null;
    const players = await this.db.query(
      `SELECT slot, nickname, is_bot, rank, status, finish_time_ms, laps_completed, verified
         FROM match_players WHERE match_id = $1 ORDER BY rank NULLS LAST, slot`,
      [id],
    );
    return { ...match.rows[0], results: players.rows };
  }

  async forPlayer(playerId: string, limit: number) {
    const { rows } = await this.db.query(
      `SELECT m.id, m.track_id, m.status, m.verified, m.ended_at, mp.rank, mp.status AS finish_status, mp.finish_time_ms, mp.verified AS result_verified
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
        WHERE mp.player_id = $1
        ORDER BY m.started_at DESC LIMIT $2`,
      [playerId, limit],
    );
    return rows;
  }

  async leaderboard(limit: number) {
    const { rows } = await this.db.query(
      `SELECT p.id, p.nickname,
              count(*) FILTER (WHERE mp.rank = 1)::int AS wins,
              count(*)::int AS races,
              min(mp.finish_time_ms) AS best_finish_ms
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id AND m.status = 'finished' AND m.verified
         JOIN players p ON p.id = mp.player_id
        WHERE mp.verified AND mp.status = 'finished'
        GROUP BY p.id, p.nickname
        ORDER BY wins DESC, best_finish_ms ASC NULLS LAST
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async reviewQueue(limit: number) {
    const { rows } = await this.db.query(
      `SELECT rq.id, rq.match_id, rq.player_id, p.nickname, rq.level, rq.score, rq.created_at,
              (SELECT json_agg(json_build_object('kind', f.kind, 'tick', f.tick, 'points', f.points, 'detail', f.detail) ORDER BY f.tick)
                 FROM anticheat_flags f WHERE f.match_id = rq.match_id AND f.player_id = rq.player_id) AS flags
         FROM review_queue rq LEFT JOIN players p ON p.id = rq.player_id
        WHERE rq.status = 'open'
        ORDER BY rq.score DESC, rq.created_at ASC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async replay(matchId: string): Promise<Buffer | null> {
    const { rows } = await this.db.query<{ data: Buffer }>("SELECT data FROM replays WHERE match_id = $1", [matchId]);
    return rows[0]?.data ?? null;
  }
}
