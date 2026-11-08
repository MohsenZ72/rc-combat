import { CAR_FLAG, type CarSnapshot, type GameConfig } from "@rc/shared";
import { PhysicsWorld, type Rapier } from "./physics.js";
import type { Track } from "./track.js";
import { applyWallResponse, integrateMovement, type MovementState } from "./vehicle.js";

interface PendingInput {
  seq: number;
  buttons: number;
}

export interface PredictedCar extends MovementState {
  x: number;
  y: number;
}

/**
 * Client-side prediction for the local car. Runs the exact same movement
 * model and wall physics as the server for instant response, then rewinds
 * to every authoritative snapshot and replays unacknowledged inputs.
 * The prediction is cosmetic: the server never reads it.
 */
export class CarPredictor {
  readonly state: PredictedCar;
  private readonly physics: PhysicsWorld;
  private readonly pending: PendingInput[] = [];
  private readonly dt: number;
  private initialised = false;
  /** Size of the last correction in metres (for debugging/visual smoothing). */
  lastCorrection = 0;

  constructor(rapier: Rapier, track: Track, private readonly config: GameConfig, private readonly slot = 0) {
    this.physics = new PhysicsWorld(rapier, track, config.car.radius);
    this.dt = 1 / config.net.tickRate;
    const pose = track.gridPose(0);
    this.state = {
      x: pose.x, y: pose.y, heading: pose.heading, vx: 0, vy: 0, yawRate: 0, speedCap: config.car.maxSpeed,
      drifting: false, turboTicks: 0, stunTicks: 0, empTicks: 0, wreckTicks: 0, finished: false,
    };
    this.physics.addCar(this.slot, pose.x, pose.y);
  }

  get ready(): boolean {
    return this.initialised;
  }

  /** Applies a local input immediately and remembers it until the server acks it. */
  applyInput(seq: number, buttons: number, racing: boolean): void {
    if (!this.initialised) return;
    if (racing) this.simulate(buttons);
    this.pending.push({ seq, buttons: racing ? buttons : 0 });
    if (this.pending.length > 120) this.pending.shift();
  }

  /** Rewinds to the server state for our car and replays inputs the server has not processed yet. */
  reconcile(server: CarSnapshot, ack: number, racing: boolean): void {
    const before = { x: this.state.x, y: this.state.y };
    const s = this.state;
    s.x = server.x;
    s.y = server.y;
    s.heading = server.heading;
    s.vx = server.vx;
    s.vy = server.vy;
    s.turboTicks = server.turboTicks;
    s.stunTicks = server.stunTicks;
    s.empTicks = server.empTicks;
    s.wreckTicks = (server.flags & CAR_FLAG.WRECKED) !== 0 ? 1 : 0;
    s.finished = (server.flags & CAR_FLAG.FINISHED) !== 0;
    s.drifting = (server.flags & CAR_FLAG.DRIFTING) !== 0;
    s.speedCap = Math.max(this.config.car.maxSpeed, Math.hypot(server.vx, server.vy));
    while (this.pending.length > 0 && !isNewer(this.pending[0]!.seq, ack)) this.pending.shift();
    if (racing && this.initialised) for (const p of this.pending) this.simulate(p.buttons);
    this.lastCorrection = this.initialised ? Math.hypot(s.x - before.x, s.y - before.y) : 0;
    this.initialised = true;
  }

  private simulate(buttons: number): void {
    const s = this.state;
    if (s.turboTicks > 0) s.turboTicks--;
    if (s.stunTicks > 0) s.stunTicks--;
    if (s.empTicks > 0) s.empTicks--;
    integrateMovement(s, buttons, this.dt, this.config);
    if (s.wreckTicks > 0) return;
    const res = this.physics.moveCar(this.slot, s.x, s.y, s.vx * this.dt, s.vy * this.dt);
    s.x = res.x;
    s.y = res.y;
    if (res.hitWall) applyWallResponse(s, res.nx, res.ny, this.config);
  }

  dispose(): void {
    this.physics.dispose();
  }
}

function isNewer(a: number, b: number): boolean {
  const diff = (a - b) & 0xffff;
  return diff !== 0 && diff < 0x8000;
}
