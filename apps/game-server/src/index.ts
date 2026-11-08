import { defineRoom, defineServer, matchMaker, WebSocketTransport } from "colyseus";
import { DEFAULT_CONFIG, mergeConfig } from "@rc/shared";
import { loadRapier, Track, TRACKS, WORKSHOP_CIRCUIT } from "@rc/game-core";
import { HttpBackend } from "./api-client.js";
import { TokenVerifier } from "./auth.js";
import { loadEnv } from "./env.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { RaceRoom } from "./rooms/race-room.js";

interface Request {
  headers: Record<string, string | string[] | undefined>;
}
interface JsonResponse {
  json(body: unknown): void;
  status(code: number): JsonResponse;
}

const env = loadEnv();
const config = mergeConfig(DEFAULT_CONFIG, {
  maxPlayers: env.MAX_PLAYERS,
  net: { tickRate: env.TICK_RATE, snapshotDivisor: env.SNAPSHOT_DIVISOR },
});
const rapier = await loadRapier();
const track = new Track(TRACKS[WORKSHOP_CIRCUIT.id]!);
const backend = new HttpBackend(env.API_INTERNAL_URL, env.INTERNAL_API_KEY, logger);
const verifier = new TokenVerifier(env.JWT_SECRET, env.JWT_ISSUER, env.JWT_AUDIENCE, backend);
RaceRoom.deps = { env, config, rapier, track, verifier, backend, log: logger };

// Only our own web client may call the matchmaking HTTP routes from a browser.
const allowedOrigins = new Set(env.CLIENT_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean));
const defaultCors = matchMaker.controller.getCorsHeaders.bind(matchMaker.controller);
matchMaker.controller.getCorsHeaders = (headers: Headers) => {
  const origin = headers.get("origin") ?? "";
  return { ...defaultCors(headers), "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : [...allowedOrigins][0] ?? "null", Vary: "Origin" };
};

const server = defineServer({
  rooms: { race: defineRoom(RaceRoom) },
  transport: new WebSocketTransport({
    maxPayload: config.net.maxMessageBytes,
    pingInterval: 5000,
    pingMaxRetries: 3,
    verifyClient: (info: { origin?: string }, done: (ok: boolean, code?: number) => void) => {
      // Browsers always send Origin; non-browser tools (load tests) are still authenticated by token.
      if (!info.origin || allowedOrigins.has(info.origin) || env.NODE_ENV !== "production") return done(true);
      done(false, 403);
    },
  }),
  gracefullyShutdown: true,
  express: (app) => {
    app.get("/health", (_req: Request, res: JsonResponse) => {
      res.json({ ok: true, serverId: env.GAME_SERVER_ID });
    });
    app.get("/metrics", (req: Request, res: JsonResponse) => {
      if (req.headers["x-internal-key"] !== env.INTERNAL_API_KEY) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      res.json(metrics.report());
    });
  },
});

await server.listen(env.GAME_SERVER_PORT);
logger.info({ port: env.GAME_SERVER_PORT, serverId: env.GAME_SERVER_ID, tickRate: config.net.tickRate }, "game server listening");
// Any match this server id was running before a crash/restart is now abandoned.
void backend.serverBooted(env.GAME_SERVER_ID);
