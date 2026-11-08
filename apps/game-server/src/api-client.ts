import type { MatchOutcome, MatchStartPayload } from "@rc/shared";
import { gzipSync } from "node:zlib";
import type { Logger } from "./logger.js";

export interface SessionInfo {
  playerId: string;
  nickname: string;
  status: "active" | "suspended";
}

/** Port the game server uses to talk to the persistent backend. */
export interface BackendPort {
  validateSession(sessionId: string, playerId: string): Promise<SessionInfo | null>;
  matchStarted(payload: MatchStartPayload): Promise<void>;
  matchFinished(outcome: MatchOutcome, replay: unknown): Promise<void>;
  serverBooted(serverId: string): Promise<void>;
}

/**
 * HTTP adapter for the NestJS API's /internal routes, authenticated with a
 * shared internal key. Result uploads are retried because they decide
 * rankings (and, later, payouts).
 */
export class HttpBackend implements BackendPort {
  constructor(
    private readonly baseUrl: string,
    private readonly internalKey: string,
    private readonly log: Logger,
  ) {}

  async validateSession(sessionId: string, playerId: string): Promise<SessionInfo | null> {
    const res = await this.request("POST", "/internal/sessions/validate", { sessionId, playerId }, 3000);
    if (res.status === 404 || res.status === 401) return null;
    if (!res.ok) throw new Error(`session validation failed: ${res.status}`);
    return (await res.json()) as SessionInfo;
  }

  async matchStarted(payload: MatchStartPayload): Promise<void> {
    await this.withRetry("matchStarted", () => this.request("POST", "/internal/matches", payload, 5000));
  }

  async matchFinished(outcome: MatchOutcome, replay: unknown): Promise<void> {
    const replayGz = gzipSync(Buffer.from(JSON.stringify(replay))).toString("base64");
    await this.withRetry("matchFinished", () =>
      this.request("POST", `/internal/matches/${outcome.matchId}/result`, { outcome, replayGz }, 15000),
    );
  }

  async serverBooted(serverId: string): Promise<void> {
    await this.withRetry("serverBooted", () => this.request("POST", `/internal/servers/${encodeURIComponent(serverId)}/boot`, {}, 5000));
  }

  private async request(method: string, path: string, body: unknown, timeoutMs: number): Promise<Response> {
    return fetch(new URL(path, this.baseUrl), {
      method,
      headers: { "content-type": "application/json", "x-internal-key": this.internalKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private async withRetry(label: string, fn: () => Promise<Response>, attempts = 5): Promise<void> {
    let delay = 500;
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await fn();
        if (res.ok) return;
        const text = await res.text().catch(() => "");
        // 4xx (except 429) will not succeed on retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          this.log.error({ label, status: res.status, body: text.slice(0, 300) }, "backend rejected request");
          return;
        }
        this.log.warn({ label, status: res.status, attempt: i }, "backend request failed, retrying");
      } catch (err) {
        this.log.warn({ label, attempt: i, err: (err as Error).message }, "backend unreachable, retrying");
      }
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
    this.log.error({ label }, "backend request gave up");
  }
}
