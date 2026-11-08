import { Inject, Injectable } from "@nestjs/common";
import { Database } from "../database/database.js";

export interface LiveSession {
  session_id: string;
  player_id: string;
  nickname: string;
  status: "active" | "suspended" | "banned";
}

@Injectable()
export class SessionsRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  async create(playerId: string, expiresAt: Date): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>("INSERT INTO sessions (player_id, expires_at) VALUES ($1, $2) RETURNING id", [
      playerId,
      expiresAt,
    ]);
    return rows[0]!.id;
  }

  /** A session that is not expired, not revoked and belongs to `playerId`. */
  async findLive(sessionId: string, playerId: string): Promise<LiveSession | null> {
    const { rows } = await this.db.query<LiveSession>(
      `SELECT s.id AS session_id, p.id AS player_id, p.nickname, p.status
         FROM sessions s JOIN players p ON p.id = s.player_id
        WHERE s.id = $1 AND s.player_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sessionId, playerId],
    );
    return rows[0] ?? null;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [sessionId]);
  }
}
