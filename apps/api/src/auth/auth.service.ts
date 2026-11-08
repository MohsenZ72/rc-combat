import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { ENV, type Env } from "../config/env.js";
import { PlayersRepository } from "../players/players.repository.js";
import { SessionsRepository } from "./sessions.repository.js";

export interface AuthedPlayer {
  playerId: string;
  sessionId: string;
  nickname: string;
}

export interface SessionInfo {
  playerId: string;
  nickname: string;
  status: "active" | "suspended";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Issues short-lived HS256 access tokens bound to a server-side session row.
 * A token is only useful while its session is live, so suspensions and
 * logouts take effect immediately, not when the token expires.
 */
@Injectable()
export class AuthService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PlayersRepository) private readonly players: PlayersRepository,
    @Inject(SessionsRepository) private readonly sessions: SessionsRepository,
  ) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async guestLogin(nickname: string) {
    const player = await this.players.create(nickname);
    const expiresAt = new Date(Date.now() + this.env.JWT_TTL_SECONDS * 1000);
    const sessionId = await this.sessions.create(player.id, expiresAt);
    const token = await new SignJWT({ sid: sessionId, nick: player.nickname })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(player.id)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt: expiresAt.toISOString(), player: { id: player.id, nickname: player.nickname } };
  }

  async authenticate(token: string): Promise<AuthedPlayer | null> {
    if (!token || token.length > 2048) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        algorithms: ["HS256"],
      });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
      const info = await this.validateSession(payload.sid, payload.sub);
      if (!info || info.status !== "active") return null;
      return { playerId: info.playerId, sessionId: payload.sid, nickname: info.nickname };
    } catch {
      return null;
    }
  }

  /** Used by game servers at join time. Returns null for unknown/expired/revoked sessions. */
  async validateSession(sessionId: string, playerId: string): Promise<SessionInfo | null> {
    if (!UUID.test(sessionId) || !UUID.test(playerId)) return null;
    const session = await this.sessions.findLive(sessionId, playerId);
    if (!session) return null;
    const player = await this.players.refreshStatus(playerId);
    if (!player) return null;
    return { playerId: player.id, nickname: player.nickname, status: player.status === "active" ? "active" : "suspended" };
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }
}
