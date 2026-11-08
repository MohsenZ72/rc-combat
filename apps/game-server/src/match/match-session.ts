import { randomUUID } from "node:crypto";
import {
  configHash,
  encodeSnapshot,
  MSG,
  Phase,
  PRIVATE_EVENT_TYPES,
  SLOT_COLORS,
  withSnapshotAck,
  type GameConfig,
  type GameEvent,
  type MatchOutcome,
  type MatchStartPayload,
  type PlayerResult,
  type PlayerSeat,
} from "@rc/shared";
import { BotDriver, InputGuard, levelAtLeast, RaceSimulation, ReplayRecorder, type Rapier, type Replay, type Track } from "@rc/game-core";
import { TelemetryCollector } from "./telemetry.js";

export interface Seat extends PlayerSeat {
  connected: boolean;
  /** Permanently gone (left during the race or never came back). */
  gone: boolean;
  guard: InputGuard | null;
  bot: BotDriver | null;
  telemetry: TelemetryCollector | null;
  lastButtons: number;
  lastInputMs: number;
  pendingPings: Map<number, number>;
  pingMs: number;
  pingMaxMs: number;
  disconnects: number;
  reconnects: number;
}

export interface SessionDeps {
  rapier: Rapier;
  track: Track;
  config: GameConfig;
  serverId: string;
  matchId?: string;
  seed?: number;
}

export interface StepOutput {
  /** Events everyone may see. */
  publicEvents: GameEvent[];
  /** Events only one player may see (their own anomalies, refused item uses). */
  privateEvents: Map<number, GameEvent[]>;
  /** Encoded snapshot with ack 0 when one is due this tick, else null. */
  snapshot: Uint8Array | null;
  finished: boolean;
}

export type SessionPhase = "lobby" | "running" | "finished";

/**
 * One match, independent of the networking framework. Owns seats, the
 * authoritative simulation, input guards, telemetry, anti-cheat verdicts and
 * the replay. The Colyseus room is a thin adapter around this class, which
 * keeps the rules testable without sockets.
 */
export class MatchSession {
  readonly matchId: string;
  readonly seed: number;
  readonly seats: Seat[] = [];
  phase: SessionPhase = "lobby";
  sim: RaceSimulation | null = null;
  private recorder: ReplayRecorder | null = null;
  private startedAt: Date | null = null;
  private endedAt: Date | null = null;
  private readonly deps: SessionDeps;

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.matchId = deps.matchId ?? randomUUID();
    this.seed = deps.seed ?? (Math.random() * 0x7fffffff) | 0;
  }

  get config(): GameConfig {
    return this.deps.config;
  }

  get humans(): Seat[] {
    return this.seats.filter((s) => !s.isBot);
  }

  get connectedHumans(): number {
    return this.seats.filter((s) => !s.isBot && s.connected && !s.gone).length;
  }

  findByPlayer(playerId: string): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId && !s.gone);
  }

  /** Adds a human to the lobby. Throws if the match already started or is full. */
  addHuman(playerId: string, nickname: string, nowMs: number): Seat {
    if (this.phase !== "lobby") throw new Error("match already started");
    if (this.seats.length >= this.config.maxPlayers) throw new Error("match full");
    if (this.findByPlayer(playerId)) throw new Error("player already in match");
    const seat = this.makeSeat(this.freeSlot(), playerId, nickname, false, nowMs);
    this.seats.push(seat);
    this.seats.sort((a, b) => a.slot - b.slot);
    return seat;
  }

  /** Removes a player before the race (lobby leave). */
  removeFromLobby(slot: number): void {
    if (this.phase !== "lobby") return;
    const i = this.seats.findIndex((s) => s.slot === slot);
    if (i >= 0) this.seats.splice(i, 1);
  }

  /** Locks the roster, fills empty seats with bots if allowed and starts the countdown. */
  start(fillWithBots: boolean, nowMs: number): MatchStartPayload {
    if (this.phase !== "lobby") throw new Error("already started");
    if (fillWithBots) {
      let n = 1;
      while (this.seats.length < this.config.maxPlayers) {
        const slot = this.freeSlot();
        const seat = this.makeSeat(slot, null, `Bot ${n++}`, true, nowMs);
        seat.bot = new BotDriver(slot, this.seed, 0.45 + ((slot * 37) % 50) / 100);
        this.seats.push(seat);
      }
    }
    // Re-pack slots 0..n-1 so the simulation has no holes.
    this.seats.sort((a, b) => a.slot - b.slot);
    this.seats.forEach((s, i) => {
      s.slot = i;
      s.color = SLOT_COLORS[i % SLOT_COLORS.length]!;
      if (s.bot) s.bot = new BotDriver(i, this.seed, 0.45 + ((i * 37) % 50) / 100);
      s.telemetry = new TelemetryCollector(i, 1 / this.config.net.tickRate);
    });
    this.sim = new RaceSimulation({ rapier: this.deps.rapier, track: this.deps.track, config: this.config, seed: this.seed, slots: this.seats.length });
    this.startedAt = new Date(nowMs);
    this.recorder = new ReplayRecorder({
      matchId: this.matchId,
      trackId: this.deps.track.def.id,
      seed: this.seed,
      config: this.config,
      slots: this.seats.length,
      players: this.seats.map(({ slot, playerId, nickname, isBot, color }) => ({ slot, playerId, nickname, isBot, color })),
      startedAt: this.startedAt.toISOString(),
    });
    for (const seat of this.seats) seat.lastInputMs = nowMs;
    this.phase = "running";
    return {
      matchId: this.matchId,
      serverId: this.deps.serverId,
      trackId: this.deps.track.def.id,
      seed: this.seed,
      configHash: configHash(this.config),
      players: this.seats.map((s) => ({ slot: s.slot, playerId: s.playerId, nickname: s.nickname, isBot: s.isBot })),
    };
  }

  // ------------------------------------------------------------ client traffic

  /** Handles one INPUT message. Returns true when the client must be kicked. */
  onInput(slot: number, payload: unknown, nowMs: number): boolean {
    const seat = this.seat(slot);
    if (!seat?.guard || seat.gone || this.phase !== "running") return false;
    const verdict = seat.guard.receive(payload, nowMs);
    if (verdict.accepted) seat.lastInputMs = nowMs;
    if (verdict.anomaly && this.sim) this.sim.reportAnomaly(slot, verdict.anomaly, verdict.detail ?? "");
    return this.shouldKick(seat);
  }

  /** A message type clients are not allowed to send (e.g. "finish", "setScore"). */
  onForbiddenMessage(slot: number, type: string | number, nowMs: number): boolean {
    const seat = this.seat(slot);
    if (!seat?.guard) return false;
    seat.guard.recordViolation(nowMs);
    this.sim?.reportAnomaly(slot, "forbidden_message", `type ${String(type).slice(0, 32)}`);
    return this.shouldKick(seat);
  }

  makePing(slot: number, nowMs: number): { t: number } | null {
    const seat = this.seat(slot);
    if (!seat || seat.isBot || !seat.connected) return null;
    seat.pendingPings.set(nowMs, nowMs);
    if (seat.pendingPings.size > 8) seat.pendingPings.delete(seat.pendingPings.keys().next().value!);
    return { t: nowMs };
  }

  /** RTT is measured from the server's own timestamps; unknown echoes are ignored. */
  onPong(slot: number, payload: unknown, nowMs: number): void {
    const seat = this.seat(slot);
    if (!seat) return;
    const t = typeof payload === "object" && payload !== null ? (payload as { t?: unknown }).t : undefined;
    if (typeof t !== "number" || !seat.pendingPings.has(t)) return;
    seat.pendingPings.delete(t);
    const rtt = nowMs - t;
    seat.pingMs = seat.pingMs === 0 ? rtt : seat.pingMs * 0.8 + rtt * 0.2;
    seat.pingMaxMs = Math.max(seat.pingMaxMs, rtt);
  }

  // ------------------------------------------------------------ connection lifecycle

  drop(slot: number): void {
    const seat = this.seat(slot);
    if (!seat || seat.gone) return;
    seat.connected = false;
    seat.disconnects++;
    if (this.sim && this.recorder) {
      this.recorder.recordControl({ tick: this.sim.tick + 1, type: "disconnect", slot, disconnected: true });
      this.sim.setDisconnected(slot, true);
    }
  }

  reconnect(slot: number): void {
    const seat = this.seat(slot);
    if (!seat || seat.gone) return;
    seat.connected = true;
    seat.reconnects++;
    seat.guard?.resetQueue();
    if (this.sim && this.recorder) {
      this.recorder.recordControl({ tick: this.sim.tick + 1, type: "disconnect", slot, disconnected: false });
      this.sim.setDisconnected(slot, false);
    }
  }

  /** Permanent leave during the race: the car is removed and ranked last. */
  leave(slot: number, reason: "left" | "timeout" | "kicked"): void {
    const seat = this.seat(slot);
    if (!seat || seat.gone) return;
    seat.connected = false;
    seat.gone = true;
    if (this.sim && this.recorder && this.phase === "running") {
      this.recorder.recordControl({ tick: this.sim.tick + 1, type: "forfeit", slot, reason });
      this.sim.forfeit(slot, reason);
    }
  }

  /** Every human left: end the race now. */
  abandon(nowMs: number): void {
    if (!this.sim || this.phase !== "running") return;
    this.sim.abort("abandoned");
    this.recorder?.afterStep(this.sim, this.sim.drainEvents());
    this.finish(nowMs);
  }

  // ------------------------------------------------------------ simulation

  step(nowMs: number, timeoutMs = 60_000): StepOutput {
    const sim = this.sim;
    if (!sim || !this.recorder || this.phase !== "running") {
      return { publicEvents: [], privateEvents: new Map(), snapshot: null, finished: this.phase === "finished" };
    }
    // AFK while connected during the race → treated like leaving.
    if (sim.phase === Phase.Racing) {
      for (const seat of this.seats) {
        if (!seat.isBot && seat.connected && !seat.gone && nowMs - seat.lastInputMs > timeoutMs) this.leave(seat.slot, "timeout");
      }
    }
    const inputs = new Array<number>(this.seats.length).fill(0);
    for (const seat of this.seats) {
      if (seat.gone) continue;
      if (seat.bot) {
        seat.lastButtons = seat.bot.decide({ track: sim.track, cars: sim.cars, tickRate: sim.tickRate, projectiles: sim.activeProjectiles() });
      } else if (seat.guard) {
        // One input per tick; if none arrived, the last one is held (TCP has no loss, only delay).
        const next = seat.connected ? seat.guard.take() : null;
        if (next) seat.lastButtons = next.buttons;
        if (!seat.connected) seat.lastButtons = 0;
      }
      inputs[seat.slot] = seat.lastButtons;
    }
    this.recorder.recordInputs(sim.tick + 1, inputs);
    sim.step(inputs);
    const events = sim.drainEvents();
    this.recorder.afterStep(sim, events);

    const publicEvents: GameEvent[] = [];
    const privateEvents = new Map<number, GameEvent[]>();
    for (const e of events) {
      for (const seat of this.seats) seat.telemetry?.event(e);
      if (PRIVATE_EVENT_TYPES.has(e.type)) {
        const slot = (e as { slot: number }).slot;
        // Anomaly details stay server-side; players only learn their item refusals.
        if (e.type === "anomaly") continue;
        const list = privateEvents.get(slot) ?? [];
        list.push(e);
        privateEvents.set(slot, list);
      } else {
        publicEvents.push(e);
      }
    }
    for (const seat of this.seats) {
      const car = sim.cars[seat.slot];
      if (car && !car.forfeited) seat.telemetry?.sample(car);
    }
    const snapshotDue = sim.tick % this.config.net.snapshotDivisor === 0 || sim.phase === Phase.Finished;
    const snapshot = snapshotDue ? encodeSnapshot(sim.snapshot(0)) : null;
    let finished = false;
    if (sim.phase === Phase.Finished) {
      this.finish(nowMs);
      finished = true;
    }
    return { publicEvents, privateEvents, snapshot, finished };
  }

  /** Snapshot bytes for one recipient (ack = last input of theirs the server applied). */
  snapshotFor(slot: number, encoded: Uint8Array): Uint8Array {
    return withSnapshotAck(encoded, this.seat(slot)?.guard?.lastAppliedSeq ?? 0);
  }

  welcome(slot: number): Record<string, unknown> {
    return {
      matchId: this.matchId,
      slot,
      trackId: this.deps.track.def.id,
      trackName: this.deps.track.def.name,
      configHash: configHash(this.config),
      tickRate: this.config.net.tickRate,
      snapshotDivisor: this.config.net.snapshotDivisor,
      laps: this.config.race.laps,
      seats: this.seats.map(({ slot: s, nickname, isBot, color }) => ({ slot: s, nickname, isBot, color })),
      messageTypes: MSG,
    };
  }

  // ------------------------------------------------------------ results

  private finish(nowMs: number): void {
    if (this.phase === "finished") return;
    this.phase = "finished";
    this.endedAt = new Date(nowMs);
  }

  /** Final verified outcome + replay. Only valid after the match finished. */
  outcome(): { outcome: MatchOutcome; replay: Replay } {
    const sim = this.sim;
    if (!sim || !this.recorder || !this.startedAt) throw new Error("match never started");
    const replay = this.recorder.finish(sim);
    const ac = this.config;
    const results: PlayerResult[] = sim.results().map((r) => {
      const seat = this.seat(r.slot)!;
      const tracker = sim.suspicion[r.slot]!;
      const telemetry = seat.telemetry!.data;
      if (seat.guard) {
        telemetry.inputsReceived = seat.guard.received;
        telemetry.inputsDropped = seat.guard.dropped;
        telemetry.inputsRejected = seat.guard.rejected;
        const iv = seat.guard.packetIntervalStats();
        telemetry.packetIntervalMeanMs = iv.meanMs;
        telemetry.packetIntervalJitterMs = iv.jitterMs;
      }
      telemetry.pingMs = Math.round(seat.pingMs);
      telemetry.pingMaxMs = Math.round(seat.pingMaxMs);
      telemetry.disconnects = seat.disconnects;
      telemetry.reconnects = seat.reconnects;
      return {
        slot: r.slot,
        playerId: seat.playerId,
        nickname: seat.nickname,
        isBot: seat.isBot,
        rank: r.rank,
        status: r.status,
        finishTimeMs: r.finishTicks === null ? null : Math.round((r.finishTicks * 1000) / ac.net.tickRate),
        lapsCompleted: r.lapsCompleted,
        progress: Math.round(r.progress * 10) / 10,
        suspicionScore: Math.round(tracker.score * 10) / 10,
        suspicionLevel: tracker.level,
        verified: !levelAtLeast(tracker.level, "restricted"),
        telemetry,
        anomalies: tracker.records,
      };
    });
    const abandoned = sim.endReason === "abandoned";
    const invalidated = results.some((r) => !r.isBot && levelAtLeast(r.suspicionLevel, "match_invalidated"));
    const outcome: MatchOutcome = {
      matchId: this.matchId,
      serverId: this.deps.serverId,
      trackId: this.deps.track.def.id,
      seed: this.seed,
      configHash: configHash(this.config),
      tickRate: this.config.net.tickRate,
      status: abandoned ? "abandoned" : invalidated ? "invalidated" : "finished",
      startedAt: this.startedAt.toISOString(),
      endedAt: (this.endedAt ?? new Date()).toISOString(),
      endReason: sim.endReason ?? "unknown",
      verified: !abandoned && !invalidated,
      results,
    };
    return { outcome, replay };
  }

  dispose(): void {
    this.sim?.dispose();
    this.sim = null;
  }

  // ------------------------------------------------------------ helpers

  private seat(slot: number): Seat | undefined {
    return this.seats.find((s) => s.slot === slot);
  }

  private freeSlot(): number {
    for (let i = 0; i < this.config.maxPlayers; i++) if (!this.seats.some((s) => s.slot === i)) return i;
    throw new Error("no free slot");
  }

  private shouldKick(seat: Seat): boolean {
    return (seat.guard?.violationsInWindow() ?? 0) >= this.config.antiCheat.kickAfterProtocolViolations;
  }

  private makeSeat(slot: number, playerId: string | null, nickname: string, isBot: boolean, nowMs: number): Seat {
    return {
      slot,
      playerId,
      nickname,
      isBot,
      color: SLOT_COLORS[slot % SLOT_COLORS.length]!,
      connected: !isBot,
      gone: false,
      guard: isBot ? null : new InputGuard(this.config.net, nowMs, this.config.antiCheat.protocolViolationWindowSeconds),
      bot: null,
      telemetry: null,
      lastButtons: 0,
      lastInputMs: nowMs,
      pendingPings: new Map(),
      pingMs: 0,
      pingMaxMs: 0,
      disconnects: 0,
      reconnects: 0,
    };
  }
}
