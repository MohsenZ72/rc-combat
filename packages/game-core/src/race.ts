import type { CarState } from "./car.js";
import { segmentIntersectT } from "./math.js";
import type { Track } from "./track.js";

export type GateResult =
  | { kind: "none" }
  | { kind: "passed"; gate: number; lapCompleted: boolean; finished: boolean }
  | { kind: "reverse"; gate: number }
  | { kind: "skip"; gate: number; expected: number };

/**
 * Checks whether the move (px,py)→(car.x,car.y) crossed a checkpoint gate
 * and updates lap state. Only the next expected gate, crossed forwards,
 * counts. A forward crossing of any other gate is a skip and is ignored.
 *
 * Lap model: cars start behind gate 0. The first crossing of gate 0 starts
 * lap 1; crossing gate 0 again after every other gate completes a lap.
 */
export function processGates(car: CarState, px: number, py: number, track: Track, laps: number, tick: number): GateResult {
  const gates = track.gates;
  const mx = car.x - px;
  const my = car.y - py;
  if (mx === 0 && my === 0) return { kind: "none" };
  for (const gate of gates) {
    const t = segmentIntersectT(px, py, car.x, car.y, gate.ax, gate.ay, gate.bx, gate.by);
    if (t < 0) continue;
    const forward = mx * gate.tx + my * gate.ty > 0;
    if (!forward) return { kind: "reverse", gate: gate.index };
    if (gate.index !== car.nextGate) {
      // Forward over a gate already behind us (after reversing back over it) is harmless;
      // forward over a gate *ahead* of the expected one means the route was cut.
      const ahead = (gate.index - car.nextGate + gates.length) % gates.length;
      if (ahead > gates.length / 2) return { kind: "none" };
      return { kind: "skip", gate: gate.index, expected: car.nextGate };
    }
    car.gatesPassed += 1;
    car.lastGate = gate.index;
    car.lastGateTick = tick;
    let lapCompleted = false;
    let finished = false;
    if (gate.index === 0) {
      if (car.lap > 0) lapCompleted = true;
      car.lap += 1;
      if (car.lap > laps) {
        car.lap = laps;
        car.finished = true;
        car.finishTick = tick;
        finished = true;
      }
    }
    car.nextGate = (gate.index + 1) % gates.length;
    return { kind: "passed", gate: gate.index, lapCompleted, finished };
  }
  return { kind: "none" };
}

/**
 * Race progress in metres along the route. Only distance confirmed by
 * passed gates counts, plus a bounded distance towards the next gate, so a
 * car cannot gain rank by being somewhere it has not legally reached.
 */
export function computeProgress(car: CarState, track: Track, s: number): number {
  const spacing = track.length / track.gates.length;
  if (car.gatesPassed === 0) {
    // Behind the start line: negative distance to gate 0.
    const behind = track.length - s;
    return -Math.min(behind, spacing);
  }
  const lastS = track.gates[car.lastGate]!.s;
  let ahead = s - lastS;
  if (ahead < -track.length / 2) ahead += track.length;
  if (ahead > track.length / 2) ahead -= track.length;
  const clamped = Math.max(0, Math.min(spacing, ahead));
  return (car.gatesPassed - 1) * spacing + clamped;
}

/**
 * Ranking: finished cars by finish tick, then active cars by progress,
 * forfeited cars last. Ties broken by slot for determinism.
 */
export function rankCars(cars: CarState[]): void {
  const order = [...cars].sort((a, b) => {
    if (a.forfeited !== b.forfeited) return a.forfeited ? 1 : -1;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished && a.finishTick !== b.finishTick) return a.finishTick - b.finishTick;
    if (!a.finished && b.progress !== a.progress) return b.progress - a.progress;
    return a.slot - b.slot;
  });
  order.forEach((car, i) => {
    car.rank = i + 1;
  });
}
