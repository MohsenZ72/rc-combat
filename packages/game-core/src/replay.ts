import { configHash, type GameConfig, type GameEvent, type PlayerSeat } from "@rc/shared";
import type { Rapier } from "./physics.js";
import { RaceSimulation } from "./simulation.js";
import { Track, type TrackDefinition } from "./track.js";

export const REPLAY_VERSION = 1;
const KEYFRAME_FIELDS = 8;

export interface ReplayHeader {
  version: number;
  matchId: string;
  trackId: string;
  seed: number;
  configHash: string;
  config: GameConfig;
  slots: number;
  players: PlayerSeat[];
  startedAt: string;
}

/** Session changes that alter the simulation and must be replayed in order. */
export type ReplayControl =
  | { tick: number; type: "forfeit"; slot: number; reason: "left" | "timeout" | "kicked" }
  | { tick: number; type: "disconnect"; slot: number; disconnected: boolean };

/**
 * Compact, semi-deterministic match record. Inputs are run-length encoded
 * per slot as flat [tick, buttons, tick, buttons, …] — only changes are
 * stored. Keyframes let an investigator audit positions without re-running,
 * and let `verifyReplay` prove the recorded inputs produce the same match.
 */
export interface Replay {
  header: ReplayHeader;
  inputs: number[][];
  controls: ReplayControl[];
  /** Flat [tick, slot, x, y, heading, vx, vy, hp] rows, 3 decimals. */
  keyframes: number[];
  keyframeInterval: number;
  events: GameEvent[];
  endTick: number;
  endReason: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class ReplayRecorder {
  private readonly lastButtons: number[];
  readonly replay: Replay;

  constructor(header: Omit<ReplayHeader, "version" | "configHash">, keyframeInterval = 30) {
    this.replay = {
      header: { ...header, version: REPLAY_VERSION, configHash: configHash(header.config) },
      inputs: Array.from({ length: header.slots }, () => []),
      controls: [],
      keyframes: [],
      keyframeInterval,
      events: [],
      endTick: 0,
      endReason: null,
    };
    this.lastButtons = Array.from({ length: header.slots }, () => -1);
  }

  /** Call with the inputs right before `sim.step(inputs)`; `tick` = sim.tick + 1. */
  recordInputs(tick: number, inputs: ArrayLike<number>): void {
    for (let slot = 0; slot < this.lastButtons.length; slot++) {
      const b = inputs[slot] ?? 0;
      if (b !== this.lastButtons[slot]) {
        this.replay.inputs[slot]!.push(tick, b);
        this.lastButtons[slot] = b;
      }
    }
  }

  /** Session change applied before the step of `tick`. */
  recordControl(control: ReplayControl): void {
    this.replay.controls.push(control);
  }

  /** Call after each step. */
  afterStep(sim: RaceSimulation, events: GameEvent[]): void {
    for (const e of events) if (e.type !== "countdown") this.replay.events.push(e);
    if (sim.tick % this.replay.keyframeInterval === 0) this.keyframe(sim);
    this.replay.endTick = sim.tick;
    this.replay.endReason = sim.endReason;
  }

  finish(sim: RaceSimulation): Replay {
    if (this.replay.keyframes.length === 0 || this.replay.keyframes[this.replay.keyframes.length - KEYFRAME_FIELDS] !== sim.tick) {
      this.keyframe(sim);
    }
    this.replay.endTick = sim.tick;
    this.replay.endReason = sim.endReason;
    return this.replay;
  }

  private keyframe(sim: RaceSimulation): void {
    for (const c of sim.cars) {
      if (c.forfeited) continue;
      this.replay.keyframes.push(sim.tick, c.slot, round3(c.x), round3(c.y), round3(c.heading), round3(c.vx), round3(c.vy), Math.round(c.hp));
    }
  }
}

export interface ReplayVerification {
  ok: boolean;
  ticks: number;
  keyframesChecked: number;
  maxPositionError: number;
  firstMismatch: { tick: number; slot: number; error: number } | null;
  resultsMatch: boolean;
}

/**
 * Re-simulates a match from its seed and input log and compares against the
 * recorded keyframes. Used for dispute investigation and in tests.
 */
export function verifyReplay(rapier: Rapier, replay: Replay, trackDef: TrackDefinition, tolerance = 0.01): ReplayVerification {
  const { header } = replay;
  if (configHash(header.config) !== header.configHash) throw new Error("replay config hash mismatch");
  const sim = new RaceSimulation({ rapier, track: new Track(trackDef), config: header.config, seed: header.seed, slots: header.slots });
  const cursors = new Array<number>(header.slots).fill(0);
  const current = new Array<number>(header.slots).fill(0);
  const controls = [...replay.controls].sort((a, b) => a.tick - b.tick);
  let controlIndex = 0;
  const expected = new Map<string, number[]>();
  for (let i = 0; i < replay.keyframes.length; i += KEYFRAME_FIELDS) {
    expected.set(`${replay.keyframes[i]}:${replay.keyframes[i + 1]}`, replay.keyframes.slice(i, i + KEYFRAME_FIELDS));
  }
  let maxErr = 0;
  let checked = 0;
  let firstMismatch: ReplayVerification["firstMismatch"] = null;
  try {
    for (let tick = 1; tick <= replay.endTick; tick++) {
      while (controlIndex < controls.length && controls[controlIndex]!.tick <= tick) {
        const c = controls[controlIndex++]!;
        if (c.type === "forfeit") sim.forfeit(c.slot, c.reason);
        else sim.setDisconnected(c.slot, c.disconnected);
      }
      for (let slot = 0; slot < header.slots; slot++) {
        const runs = replay.inputs[slot]!;
        while (cursors[slot]! < runs.length && runs[cursors[slot]!]! <= tick) {
          current[slot] = runs[cursors[slot]! + 1]!;
          cursors[slot]! += 2;
        }
      }
      sim.step(current);
      sim.drainEvents();
      if (tick % replay.keyframeInterval === 0 || tick === replay.endTick) {
        for (const car of sim.cars) {
          const row = expected.get(`${tick}:${car.slot}`);
          if (!row) continue;
          const err = Math.hypot(car.x - row[2]!, car.y - row[3]!);
          checked++;
          maxErr = Math.max(maxErr, err);
          if (err > tolerance && !firstMismatch) firstMismatch = { tick, slot: car.slot, error: err };
        }
      }
    }
    const recordedFinishes = replay.events.filter((e): e is Extract<GameEvent, { type: "finish" }> => e.type === "finish");
    const simFinishes = sim.cars.filter((c) => c.finished);
    const resultsMatch =
      recordedFinishes.length === simFinishes.length &&
      recordedFinishes.every((f) => sim.cars[f.slot]?.finished && sim.cars[f.slot]!.finishTick === f.tick);
    return { ok: firstMismatch === null && resultsMatch, ticks: replay.endTick, keyframesChecked: checked, maxPositionError: maxErr, firstMismatch, resultsMatch };
  } finally {
    sim.dispose();
  }
}
