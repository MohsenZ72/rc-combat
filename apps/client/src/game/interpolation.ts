import { lerp, lerpAngle } from "@rc/game-core";
import type { CarSnapshot, ProjectileSnapshot, Snapshot } from "@rc/shared";

interface Buffered {
  tick: number;
  cars: Map<number, CarSnapshot>;
  projectiles: Map<number, ProjectileSnapshot>;
}

export interface InterpolatedCar extends CarSnapshot {}

/**
 * Buffers server snapshots and renders remote entities slightly in the past
 * (interpolation delay) so motion is smooth between 15 Hz updates.
 */
export class SnapshotInterpolator {
  private readonly buffer: Buffered[] = [];
  private renderTick = -1;
  private latestTick = -1;
  private latestAt = 0;

  constructor(private readonly tickRate: number, private readonly delayMs: number) {}

  push(s: Snapshot, nowMs: number): void {
    if (s.tick <= this.latestTick) return;
    this.latestTick = s.tick;
    this.latestAt = nowMs;
    this.buffer.push({
      tick: s.tick,
      cars: new Map(s.cars.map((c) => [c.slot, c])),
      projectiles: new Map(s.projectiles.map((p) => [p.id, p])),
    });
    while (this.buffer.length > 40) this.buffer.shift();
  }

  /** Advances the render clock; keeps it `delayMs` behind the newest server tick. */
  advance(nowMs: number, frameMs: number): void {
    if (this.latestTick < 0) return;
    const tickMs = 1000 / this.tickRate;
    const target = this.latestTick + (nowMs - this.latestAt) / tickMs - this.delayMs / tickMs;
    if (this.renderTick < 0 || Math.abs(target - this.renderTick) > 15) this.renderTick = target;
    else this.renderTick += frameMs / tickMs + (target - this.renderTick) * 0.1;
  }

  get tick(): number {
    return this.renderTick;
  }

  /** Remote cars at the current render tick. */
  cars(): InterpolatedCar[] {
    const pair = this.pair();
    if (!pair) return [];
    const [a, b, t] = pair;
    const out: InterpolatedCar[] = [];
    for (const [slot, cb] of b.cars) {
      const ca = a.cars.get(slot);
      if (!ca) {
        out.push(cb);
        continue;
      }
      out.push({ ...cb, x: lerp(ca.x, cb.x, t), y: lerp(ca.y, cb.y, t), z: lerp(ca.z, cb.z, t), heading: lerpAngle(ca.heading, cb.heading, t) });
    }
    return out;
  }

  projectiles(): ProjectileSnapshot[] {
    const pair = this.pair();
    if (!pair) return [];
    const [a, b, t] = pair;
    const out: ProjectileSnapshot[] = [];
    for (const [id, pb] of b.projectiles) {
      const pa = a.projectiles.get(id);
      out.push(pa ? { ...pb, x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), heading: lerpAngle(pa.heading, pb.heading, t) } : pb);
    }
    return out;
  }

  private pair(): [Buffered, Buffered, number] | null {
    const n = this.buffer.length;
    if (n === 0) return null;
    if (n === 1 || this.renderTick <= this.buffer[0]!.tick) return [this.buffer[0]!, this.buffer[0]!, 0];
    for (let i = n - 1; i > 0; i--) {
      const a = this.buffer[i - 1]!;
      const b = this.buffer[i]!;
      if (this.renderTick >= a.tick) {
        const t = Math.min(1, (this.renderTick - a.tick) / (b.tick - a.tick));
        return [a, b, t];
      }
    }
    const last = this.buffer[n - 1]!;
    return [last, last, 0];
  }
}
