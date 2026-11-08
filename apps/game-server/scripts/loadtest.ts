/**
 * Multiplayer load test: N headless clients log in, matchmake, race with the
 * bot driver over real WebSockets and report latency, jitter, bandwidth and
 * server tick cost.
 *
 *   npm run loadtest -- --clients 10   --seconds 60
 *   npm run loadtest -- --clients 200  --seconds 60   # 20 full matches
 *
 * Needs the API and game server running (npm run dev). Uses the
 * non-production /internal/test/guests route to mint accounts.
 */
import { Client } from "@colyseus/sdk";
import { decodeSnapshot, DEFAULT_CONFIG, encodeInput, MSG, type Snapshot } from "@rc/shared";
import { BotDriver, Track, TRACKS, WORKSHOP_CIRCUIT, type CarState } from "@rc/game-core";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    clients: { type: "string", default: "10" },
    seconds: { type: "string", default: "60" },
    label: { type: "string" },
  },
});
const CLIENTS = Number(values.clients);
const SECONDS = Number(values.seconds);
const API = process.env.API_INTERNAL_URL ?? "http://localhost:3000";
const WS = process.env.VITE_GAME_SERVER_URL ?? `ws://localhost:${process.env.GAME_SERVER_PORT ?? 2567}`;
const HTTP = WS.replace(/^ws/, "http");
const KEY = process.env.INTERNAL_API_KEY ?? "";
const TICK_MS = 1000 / Number(process.env.TICK_RATE ?? DEFAULT_CONFIG.net.tickRate);
const tracks = new Map(Object.values(TRACKS).map((d) => [d.id, new Track(d)]));

interface ClientStats {
  joined: boolean;
  joinMs: number;
  snapshots: number;
  bytes: number;
  intervals: number[];
  rtts: number[];
  errors: string[];
  maxRank: number;
}

async function internal<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, path.startsWith("/metrics") ? HTTP : API), {
    method,
    headers: { "content-type": "application/json", "x-internal-key": KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function carsFromSnapshot(s: Snapshot): CarState[] {
  const cars: CarState[] = [];
  for (const c of s.cars) {
    cars[c.slot] = {
      ...c,
      yawRate: 0,
      forfeited: false,
      finished: (c.flags & 32) !== 0,
      wreckTicks: (c.flags & 16) !== 0 ? 1 : 0,
      lastButtons: 0,
      progress: -c.rank,
    } as unknown as CarState;
  }
  return cars;
}

async function runClient(token: string, index: number, stopAt: number): Promise<ClientStats> {
  const stats: ClientStats = { joined: false, joinMs: 0, snapshots: 0, bytes: 0, intervals: [], rtts: [], errors: [], maxRank: 0 };
  const client = new Client(WS);
  client.auth.token = token;
  const t0 = performance.now();
  let room;
  try {
    room = await client.joinOrCreate("race");
  } catch (err) {
    stats.errors.push(`join: ${(err as Error).message}`);
    return stats;
  }
  stats.joined = true;
  stats.joinMs = performance.now() - t0;
  let slot = -1;
  let bot: BotDriver | null = null;
  let track = tracks.get(WORKSHOP_CIRCUIT.id)!;
  let cars: CarState[] = [];
  let lastSnapAt = 0;
  let seq = 0;
  let lastButtons = 0;

  room.onMessage(MSG.WELCOME, (w: { slot: number; trackId: string }) => {
    slot = w.slot;
    track = tracks.get(w.trackId) ?? track;
    bot = new BotDriver(slot, 1000 + index, 0.6);
  });
  room.onMessage(MSG.SNAPSHOT, (bytes: Uint8Array) => {
    const now = performance.now();
    stats.bytes += bytes.byteLength;
    if (lastSnapAt) stats.intervals.push(now - lastSnapAt);
    lastSnapAt = now;
    stats.snapshots++;
    const d = decodeSnapshot(bytes);
    if (d.ok) cars = carsFromSnapshot(d.value);
  });
  room.onMessage(MSG.PING, (p: { t: number }) => room.send(MSG.PONG, p));
  room.onMessage(MSG.EVENT, () => undefined);
  room.onMessage(MSG.RESULTS, () => undefined);
  room.onError((code, message) => stats.errors.push(`room ${code}: ${message}`));

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (Date.now() >= stopAt) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (slot < 0 || !bot || !cars[slot]) return;
      cars[slot]!.lastButtons = lastButtons;
      lastButtons = bot.decide({ track, cars, tickRate: 1000 / TICK_MS });
      room.sendBytes(MSG.INPUT, encodeInput(++seq & 0xffff, lastButtons));
    }, TICK_MS);
  });
  await room.leave(true).catch(() => undefined);
  return stats;
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const round = (n: number) => Math.round(n * 100) / 100;

console.log(`load test: ${CLIENTS} clients, ${SECONDS}s, server ${WS}`);
const guests = await internal<{ token: string }[]>("POST", "/internal/test/guests", { count: CLIENTS, prefix: "lt" });
await internal("GET", "/metrics"); // reset the server's rolling window
const cpuStart = (await internal<{ cpu: { user: number; system: number } }>("GET", "/metrics")).cpu;
const started = Date.now();
const stopAt = started + SECONDS * 1000;
const results = await Promise.all(guests.map((g, i) => runClient(g.token, i, stopAt)));
const server = await internal<{
  tickMs: { avg: number; p99: number; max: number; count: number };
  kbOutPerSec: number;
  kbInPerSec: number;
  memoryMb: number;
  rooms: number;
  cpu: { user: number; system: number };
}>("GET", "/metrics");
const elapsedS = (Date.now() - started) / 1000;
const cpuPct = ((server.cpu.user - cpuStart.user + server.cpu.system - cpuStart.system) / 1e6 / elapsedS) * 100;

const joined = results.filter((r) => r.joined);
const intervals = joined.flatMap((r) => r.intervals);
const report = {
  label: values.label ?? `${CLIENTS}-clients`,
  clients: CLIENTS,
  seconds: SECONDS,
  joined: joined.length,
  errors: results.flatMap((r) => r.errors).slice(0, 20),
  joinMs: { p50: round(pct(joined.map((r) => r.joinMs), 0.5)), p99: round(pct(joined.map((r) => r.joinMs), 0.99)) },
  snapshotIntervalMs: { p50: round(pct(intervals, 0.5)), p99: round(pct(intervals, 0.99)), max: round(pct(intervals, 1)) },
  perClientKbPerSec: round(joined.reduce((a, r) => a + r.bytes, 0) / 1024 / elapsedS / Math.max(1, joined.length)),
  server: {
    rooms: server.rooms,
    tickMs: { avg: round(server.tickMs.avg), p99: round(server.tickMs.p99), max: round(server.tickMs.max), samples: server.tickMs.count },
    kbOutPerSec: round(server.kbOutPerSec),
    kbInPerSec: round(server.kbInPerSec),
    memoryMb: server.memoryMb,
    cpuPercentOfOneCore: round(cpuPct),
  },
};
console.log(JSON.stringify(report, null, 2));
writeFileSync(`loadtest-report-${report.label}.json`, JSON.stringify(report, null, 2));
process.exit(0);
