import { jwtVerify } from "jose";
import type { BackendPort, SessionInfo } from "./api-client.js";

export interface AuthenticatedPlayer {
  playerId: string;
  sessionId: string;
  nickname: string;
}

export class AuthError extends Error {}

interface CacheEntry {
  value: SessionInfo | null;
  expires: number;
}

/**
 * Verifies the access token signed by the API, then confirms with the API
 * that the session is still live and the account is not suspended. Session
 * checks are cached briefly so a reconnect storm does not hammer the API.
 */
export class TokenVerifier {
  private readonly key: Uint8Array;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    secret: string,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly backend: BackendPort,
    private readonly cacheMs = 30_000,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: unknown): Promise<AuthenticatedPlayer> {
    if (typeof token !== "string" || token.length < 20 || token.length > 2048) throw new AuthError("missing token");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.key, { issuer: this.issuer, audience: this.audience, algorithms: ["HS256"] }));
    } catch {
      throw new AuthError("invalid token");
    }
    const playerId = payload.sub;
    const sessionId = typeof payload.sid === "string" ? payload.sid : null;
    if (!playerId || !sessionId) throw new AuthError("malformed token");

    const cacheKey = `${sessionId}:${playerId}`;
    const cached = this.cache.get(cacheKey);
    let info: SessionInfo | null;
    if (cached && cached.expires > Date.now()) {
      info = cached.value;
    } else {
      info = await this.backend.validateSession(sessionId, playerId);
      this.cache.set(cacheKey, { value: info, expires: Date.now() + this.cacheMs });
      if (this.cache.size > 5000) this.cache.clear();
    }
    if (!info) throw new AuthError("session expired");
    if (info.status !== "active") throw new AuthError("account suspended");
    return { playerId, sessionId, nickname: info.nickname };
  }
}
