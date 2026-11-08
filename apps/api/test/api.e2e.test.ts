import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import type { MatchOutcome, MatchStartPayload, PlayerTelemetry } from "@rc/shared";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { loadEnv } from "../src/config/env.js";
import { migrate } from "../src/database/migrate.js";

/**
 * End-to-end tests against a real Postgres (DATABASE_URL from .env).
 * Run `npm run db:up` first.
 */
const env = loadEnv();
let app: INestApplication;
let http: ReturnType<typeof request>;
const KEY = { "x-internal-key": env.INTERNAL_API_KEY };

const telemetry: PlayerTelemetry = {
  ticks: 100, avgSpeed: 20, maxSpeed: 30, maxAcceleration: 15, maxYawRate: 2, distance: 500,
  inputsReceived: 100, inputsDropped: 0, inputsRejected: 0, packetIntervalMeanMs: 33, packetIntervalJitterMs: 2,
  pingMs: 40, pingMaxMs: 60, itemsPicked: 1, itemsUsed: 1, shotsFired: 3, damageDealt: 8, damageTaken: 0,
  wallCollisions: 1, carCollisions: 0, wrecks: 0, disconnects: 0, reconnects: 0,
};

async function guest(nickname: string): Promise<{ token: string; player: { id: string } }> {
  const res = await http.post("/internal/test/guests").set(KEY).send({ count: 1, prefix: nickname.slice(0, 8) });
  expect(res.status).toBe(200);
  return res.body[0];
}

function decodeSid(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sid;
}

function startPayload(players: { playerId: string | null; isBot: boolean }[], serverId = "test-server"): MatchStartPayload {
  return {
    matchId: randomUUID(),
    serverId,
    trackId: "workshop-circuit",
    seed: 1234,
    configHash: "abcd1234",
    players: players.map((p, slot) => ({ slot, playerId: p.playerId, nickname: p.isBot ? `Bot ${slot}` : `p${slot}`, isBot: p.isBot })),
  };
}

function outcomeFor(start: MatchStartPayload, over: Partial<MatchOutcome> = {}, levels: Record<number, MatchOutcome["results"][number]["suspicionLevel"]> = {}): MatchOutcome {
  return {
    matchId: start.matchId,
    serverId: start.serverId,
    trackId: start.trackId,
    seed: start.seed,
    configHash: start.configHash,
    tickRate: 30,
    status: "finished",
    startedAt: new Date(Date.now() - 300_000).toISOString(),
    endedAt: new Date().toISOString(),
    endReason: "all_finished",
    verified: true,
    results: start.players.map((p, i) => ({
      slot: p.slot,
      playerId: p.playerId,
      nickname: p.nickname,
      isBot: p.isBot,
      rank: i + 1,
      status: "finished" as const,
      finishTimeMs: 240_000 + i * 1000,
      lapsCompleted: 5,
      progress: 5000,
      suspicionScore: levels[p.slot] ? 170 : 0,
      suspicionLevel: levels[p.slot] ?? "normal",
      verified: !levels[p.slot],
      telemetry,
      anomalies: levels[p.slot] ? [{ tick: 900, kind: "teleport", points: 20, detail: "moved 40m" }] : [],
    })),
    ...over,
  };
}

const replayGz = gzipSync(Buffer.from(JSON.stringify({ header: { version: 1 }, inputs: [] }))).toString("base64");

beforeAll(async () => {
  await migrate(env.DATABASE_URL, () => undefined);
  app = await createApp({ logger: false });
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe("auth", () => {
  it("rejects invalid nicknames", async () => {
    const res = await http.post("/auth/guest").send({ nickname: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  it("issues a session that authenticates player routes", async () => {
    const res = await http.post("/auth/guest").send({ nickname: "Racer One" });
    expect(res.status).toBe(201);
    const me = await http.get("/players/me").set("authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.nickname).toBe("Racer One");
    expect(me.body.stats.matches).toBe(0);
  });

  it("rejects missing, forged and revoked tokens", async () => {
    expect((await http.get("/players/me")).status).toBe(401);
    const g = await guest("forge");
    const [h, , s] = g.token.split(".");
    const fakePayload = Buffer.from(JSON.stringify({ sub: g.player.id, sid: decodeSid(g.token), exp: 9999999999 })).toString("base64url");
    expect((await http.get("/players/me").set("authorization", `Bearer ${h}.${fakePayload}.${s}`)).status).toBe(401);
    expect((await http.post("/auth/logout").set("authorization", `Bearer ${g.token}`)).status).toBe(204);
    expect((await http.get("/players/me").set("authorization", `Bearer ${g.token}`)).status).toBe(401);
  });
});

describe("internal routes", () => {
  it("require the internal key", async () => {
    expect((await http.post("/internal/matches").send({})).status).toBe(401);
    expect((await http.post("/internal/matches").set("x-internal-key", "wrong").send({})).status).toBe(401);
  });

  it("validate live sessions for game servers", async () => {
    const g = await guest("sess");
    const ok = await http.post("/internal/sessions/validate").set(KEY).send({ sessionId: decodeSid(g.token), playerId: g.player.id });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("active");
    const bad = await http.post("/internal/sessions/validate").set(KEY).send({ sessionId: randomUUID(), playerId: g.player.id });
    expect(bad.status).toBe(404);
  });
});

describe("match results", () => {
  it("records a verified match once (idempotent) and exposes public results", async () => {
    const a = await guest("ra");
    const start = startPayload([{ playerId: a.player.id, isBot: false }, { playerId: null, isBot: true }]);
    expect((await http.post("/internal/matches").set(KEY).send(start)).body.status).toBe("created");
    expect((await http.post("/internal/matches").set(KEY).send(start)).body.status).toBe("exists");
    const first = await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: outcomeFor(start), replayGz });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("recorded");
    const again = await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: outcomeFor(start), replayGz });
    expect(again.body.status).toBe("already_recorded");
    const pub = await http.get(`/matches/${start.matchId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.results[0].rank).toBe(1);
    expect(pub.body.results[0]).not.toHaveProperty("telemetry");
    const me = await http.get("/players/me").set("authorization", `Bearer ${a.token}`);
    expect(me.body.stats.wins).toBe(1);
    const replay = await http.get(`/internal/matches/${start.matchId}/replay`).set(KEY);
    expect(replay.body.replayGz).toBe(replayGz);
  });

  it("rejects results for an unknown match", async () => {
    const start = startPayload([{ playerId: null, isBot: true }]);
    const res = await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: outcomeFor(start), replayGz });
    expect(res.status).toBe(404);
  });

  it("rejects a result whose roster differs from the registered one", async () => {
    const a = await guest("rb");
    const b = await guest("rc");
    const start = startPayload([{ playerId: a.player.id, isBot: false }, { playerId: null, isBot: true }]);
    await http.post("/internal/matches").set(KEY).send(start);
    const forged = outcomeFor(start);
    forged.results[1] = { ...forged.results[1]!, playerId: b.player.id, isBot: false };
    const res = await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: forged, replayGz });
    expect(res.status).toBe(409);
  });

  it("rejects a result from another server or with different match parameters", async () => {
    const start = startPayload([{ playerId: null, isBot: true }]);
    await http.post("/internal/matches").set(KEY).send(start);
    const other = await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: outcomeFor(start, { serverId: "evil" }), replayGz });
    expect(other.status).toBe(409);
    const seed = await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: outcomeFor(start, { seed: 999 }), replayGz });
    expect(seed.status).toBe(409);
  });

  it("rejects duplicate ranks and corrupt replays", async () => {
    const start = startPayload([{ playerId: null, isBot: true }, { playerId: null, isBot: true }]);
    await http.post("/internal/matches").set(KEY).send(start);
    const dup = outcomeFor(start);
    dup.results[1]!.rank = 1;
    expect((await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: dup, replayGz })).status).toBe(400);
    const notGzip = Buffer.from("not a replay").toString("base64");
    expect((await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome: outcomeFor(start), replayGz: notGzip })).status).toBe(400);
  });

  it("suspends a cheater, revokes their sessions and queues a review", async () => {
    const cheat = await guest("cheat");
    const start = startPayload([{ playerId: cheat.player.id, isBot: false }, { playerId: null, isBot: true }]);
    await http.post("/internal/matches").set(KEY).send(start);
    const outcome = outcomeFor(start, { status: "invalidated", verified: false }, { 0: "temporary_suspension" });
    expect((await http.post(`/internal/matches/${start.matchId}/result`).set(KEY).send({ outcome, replayGz })).status).toBe(200);
    expect((await http.get("/players/me").set("authorization", `Bearer ${cheat.token}`)).status).toBe(401);
    const check = await http.post("/internal/sessions/validate").set(KEY).send({ sessionId: decodeSid(cheat.token), playerId: cheat.player.id });
    expect(check.status).toBe(404);
    const queue = await http.get("/internal/review-queue").set(KEY);
    const entry = queue.body.find((q: { player_id: string }) => q.player_id === cheat.player.id);
    expect(entry.level).toBe("temporary_suspension");
    expect(entry.flags[0].kind).toBe("teleport");
    // Unverified results never count towards stats or the leaderboard.
    const board = await http.get("/leaderboard");
    expect(board.body.some((r: { id: string }) => r.id === cheat.player.id)).toBe(false);
  });

  it("abandons a server's running matches when it reboots", async () => {
    const start = startPayload([{ playerId: null, isBot: true }], "reboot-server");
    await http.post("/internal/matches").set(KEY).send(start);
    const res = await http.post("/internal/servers/reboot-server/boot").set(KEY);
    expect(res.body.abandoned).toBeGreaterThanOrEqual(1);
    const pub = await http.get(`/matches/${start.matchId}`);
    expect(pub.body.status).toBe("abandoned");
    expect(pub.body.end_reason).toBe("server_restart");
  });
});

describe("rate limiting", () => {
  it("limits guest sign-ups per client", async () => {
    let limited = false;
    for (let i = 0; i < env.GUEST_LOGINS_PER_MINUTE + 3 && !limited; i++) {
      const res = await http.post("/auth/guest").send({ nickname: `flood${i}` });
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
  });
});
