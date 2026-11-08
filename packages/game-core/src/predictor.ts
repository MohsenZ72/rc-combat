import { CAR_FLAG, type CarSnapshot, type GameConfig } from "@rc/shared";
import { PhysicsWorld, type Rapier } from "./physics.js";
import type { Track } from "./track.js";
import { applyWallImpact, carContact, resolveCarImpact, type ImpactBody } from "./impact.js";
import { integrateMovement, type MovementState } from "./vehicle.js";

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
  heading: number;
  vx: number;
  vy: number;
  spin?: number;
  turboTicks?: number;
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
  /** Scratch body for the obstacle side of a predicted bump. */
  private readonly other: ImpactBody = {
    x: 0, y: 0, heading: 0, vx: 0, vy: 0, z: 0, vz: 0, yawRate: 0, spin: 0, tractionTicks: 0, flipTicks: 0,
    roll: 0, rollRate: 0, pitch: 0, pitchRate: 0, speedCap: 0, turboTicks: 0,
  };
  private segmentHint = -1;
  private trackS = 0;
  /** Size of the last correction in metres (for debugging/visual smoothing). */
  lastCorrection = 0;

  constructor(rapier: Rapier, private readonly track: Track, private readonly config: GameConfig, private readonly slot = 0) {
    this.physics = new PhysicsWorld(rapier, track, config.car.radius);
    this.dt = 1 / config.net.tickRate;
    const pose = track.gridPose(0);
    this.state = {
      x: pose.x, y: pose.y, heading: pose.heading, vx: 0, vy: 0, yawRate: 0, speedCap: config.car.maxSpeed,
      drifting: false, turboTicks: 0, stunTicks: 0, empTicks: 0, wreckTicks: 0, finished: false,
      z: 0, vz: 0, jumpCooldownTicks: 0,
      spin: 0, tractionTicks: 0, flipTicks: 0, roll: 0, rollRate: 0, pitch: 0, pitchRate: 0,
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
    s.spin = server.spin;
    s.tractionTicks = server.tractionTicks;
    s.flipTicks = server.flipTicks;
    s.roll = server.roll;
    s.rollRate = server.rollRate;
    s.pitch = server.pitch;
    s.pitchRate = server.pitchRate;
    s.speedCap = Math.max(this.config.car.maxSpeed, Math.hypot(server.vx, server.vy));
    const proj = this.track.project(s.x, s.y, this.segmentHint);
    this.segmentHint = proj.segment;
    this.trackS = proj.s;
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
    const surface = this.track.surfaceUnder(s.x, s.y, s.heading, this.segmentHint);
    integrateMovement(s, buttons, this.dt, this.config, prevButtons, surface);
    if (s.wreckTicks > 0) return;
    const res = this.physics.moveCar(this.slot, s.x, s.y, s.vx * this.dt, s.vy * this.dt);
    s.x = res.x;
    s.y = res.y;
    if (res.hitWall) applyWallImpact(s, res.nx, res.ny, this.config, this.dt);
    this.bumpObstacles();
    // Mirror the server's ramp launch so take-offs feel instant.
    const proj = this.track.project(s.x, s.y, this.segmentHint);
    if (s.z === 0 && s.vz === 0 && this.track.rampCrossed(this.trackS, proj.s)) {
      if (s.vx * proj.tangentX + s.vy * proj.tangentY >= this.config.car.rampMinSpeed) s.vz = Math.min(this.config.car.rampVelocity, this.config.car.jumpVelocity);
    }
    this.segmentHint = proj.segment;
    this.trackS = proj.s;
  }

  /** Same impulse rule as the server's car-car collision; the other car is not moved. */
  private bumpObstacles(): void {
    const s = this.state;
    const o = this.other;
    for (const ob of this.obstacles) {
      if (Math.abs(ob.z - s.z) >= this.config.car.bodyHeight) continue;
      const contact = carContact(s, ob, this.config);
      if (!contact) continue;
      // Contact normal points from us to the obstacle: back off by the full overlap.
      const push = this.physics.moveCar(this.slot, s.x, s.y, -contact.nx * contact.depth, -contact.ny * contact.depth);
      o.x = ob.x; o.y = ob.y; o.z = ob.z; o.heading = ob.heading; o.vx = ob.vx; o.vy = ob.vy;
      o.spin = ob.spin ?? 0; o.turboTicks = ob.turboTicks ?? 0;
      resolveCarImpact(s, o, contact, this.config, this.dt, false);
      s.x = push.x;
      s.y = push.y;
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
