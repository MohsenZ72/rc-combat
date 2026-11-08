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

/** Another car as last reported by the server; predicted bumps resolve against it. */
export interface Obstacle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

/**
 * Client-side prediction for the local car. Runs the exact same movement
 * model and wall physics as the server for instant response, then rewinds
 * to every authoritative snapshot and replays unacknowledged inputs.
 * Other cars are treated as obstacles so bumps feel immediate instead of
 * driving through a car until the server corrects it.
 * The prediction is cosmetic: the server never reads it.
 */
export class CarPredictor {
  readonly state: PredictedCar;
  private readonly physics: PhysicsWorld;
  private readonly pending: PendingInput[] = [];
  private readonly dt: number;
  private initialised = false;
  private ackedButtons = 0;
  private prevButtons = 0;
  private obstacles: Obstacle[] = [];
  /** Size of the last correction in metres (for debugging/visual smoothing). */
  lastCorrection = 0;

  constructor(rapier: Rapier, track: Track, private readonly config: GameConfig, private readonly slot = 0) {
    this.physics = new PhysicsWorld(rapier, track, config.car.radius);
    this.dt = 1 / config.net.tickRate;
    const pose = track.gridPose(0);
    this.state = {
      x: pose.x, y: pose.y, heading: pose.heading, vx: 0, vy: 0, yawRate: 0, speedCap: config.car.maxSpeed,
      drifting: false, turboTicks: 0, stunTicks: 0, empTicks: 0, wreckTicks: 0, finished: false,
      z: 0, vz: 0, jumpCooldownTicks: 0,
    };
    this.physics.addCar(this.slot, pose.x, pose.y);
  }

  get ready(): boolean {
    return this.initialised;
  }

  setObstacles(obstacles: Obstacle[]): void {
    this.obstacles = obstacles;
  }

  /** Applies a local input immediately and remembers it until the server acks it. */
  applyInput(seq: number, buttons: number, racing: boolean): void {
    if (!this.initialised) return;
    const applied = racing ? buttons : 0;
    if (racing) this.simulate(applied, this.prevButtons);
    this.prevButtons = applied;
    this.pending.push({ seq, buttons: applied });
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
    s.z = server.z;
    s.vz = server.vz;
    s.jumpCooldownTicks = server.jumpCooldownTicks;
    s.turboTicks = server.turboTicks;
    s.stunTicks = server.stunTicks;
    s.empTicks = server.empTicks;
    s.wreckTicks = (server.flags & CAR_FLAG.WRECKED) !== 0 ? 1 : 0;
    s.finished = (server.flags & CAR_FLAG.FINISHED) !== 0;
    s.drifting = (server.flags & CAR_FLAG.DRIFTING) !== 0;
    s.speedCap = Math.max(this.config.car.maxSpeed, Math.hypot(server.vx, server.vy));
    while (this.pending.length > 0 && !isNewer(this.pending[0]!.seq, ack)) {
      this.ackedButtons = this.pending.shift()!.buttons;
    }
    let prev = this.ackedButtons;
    if (racing && this.initialised) {
      for (const p of this.pending) {
        this.simulate(p.buttons, prev);
        prev = p.buttons;
      }
    }
    this.lastCorrection = this.initialised ? Math.hypot(s.x - before.x, s.y - before.y) : 0;
    this.initialised = true;
  }

  private simulate(buttons: number, prevButtons: number): void {
    const s = this.state;
    if (s.turboTicks > 0) s.turboTicks--;
    if (s.stunTicks > 0) s.stunTicks--;
    if (s.empTicks > 0) s.empTicks--;
    integrateMovement(s, buttons, this.dt, this.config, prevButtons);
    if (s.wreckTicks > 0) return;
    const res = this.physics.moveCar(this.slot, s.x, s.y, s.vx * this.dt, s.vy * this.dt);
    s.x = res.x;
    s.y = res.y;
    if (res.hitWall) applyWallResponse(s, res.nx, res.ny, this.config);
    this.bumpObstacles();
  }

  /** Same impulse rule as the server's car-car collision, with the other car held still. */
  private bumpObstacles(): void {
    const s = this.state;
    const minDist = this.config.car.radius * 2;
    for (const o of this.obstacles) {
      if (Math.abs(o.z - s.z) >= this.config.car.bodyHeight) continue;
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const push = this.physics.moveCar(this.slot, s.x, s.y, nx * (minDist - d), ny * (minDist - d));
      s.x = push.x;
      s.y = push.y;
      const rel = (s.vx - o.vx) * nx + (s.vy - o.vy) * ny;
      if (rel < 0) {
        const j = (-(1 + this.config.car.carRestitution) * rel) / 2;
        s.vx += j * nx;
        s.vy += j * ny;
      }
    }
  }

  dispose(): void {
    this.physics.dispose();
  }
}

function isNewer(a: number, b: number): boolean {
  const diff = (a - b) & 0xffff;
  return diff !== 0 && diff < 0x8000;
}
