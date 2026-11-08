import {
  BTN,
  BTN_MASK,
  CAR_FLAG,
  ItemKind,
  Phase,
  ProjectileKind,
  secondsToTicks,
  type AnomalyKind,
  type GameConfig,
  type GameEvent,
  type ItemRejectReason,
  type ProjectileSource,
  type Snapshot,
} from "@rc/shared";
import { validateMovement, type KinematicSample } from "./anticheat/movement-validator.js";
import { SuspicionTracker } from "./anticheat/suspicion.js";
import { createCar, speedOf, type CarState } from "./car.js";
import { applyKnock, applyWallImpact, carContact, carMass, resolveCarImpact } from "./impact.js";
import { angleDelta, clamp, pointSegmentDistSq } from "./math.js";
import { PhysicsWorld, type Rapier } from "./physics.js";
import { computeProgress, processGates, rankCars } from "./race.js";
import { Rng } from "./rng.js";
import type { Track } from "./track.js";
import { absoluteSpeedCeiling, integrateMovement } from "./vehicle.js";

export interface Projectile {
  active: boolean;
  id: number;
  kind: ProjectileKind;
  owner: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  ttl: number;
  age: number;
  target: number;
}

export interface ItemBox {
  x: number;
  y: number;
  respawnTick: number;
}

export type RaceEndReason = "all_finished" | "time_limit" | "grace_expired" | "abandoned";

export interface CarResult {
  slot: number;
  rank: number;
  status: "finished" | "dnf" | "forfeit";
  finishTicks: number | null;
  lapsCompleted: number;
  progress: number;
}

export interface SimulationOptions {
  rapier: Rapier;
  track: Track;
  config: GameConfig;
  seed: number;
  slots: number;
}

const MAX_PROJECTILES = 96;
/** Height above which bolts and rockets pass under a car. */
const SHOT_HEIGHT = 0.6;
/** Height above which a car does not set off a mine. */
const MINE_TRIGGER_HEIGHT = 0.3;
const ROCKET_TARGET_RANGE = 220;
const ITEM_WEIGHTS_FRONT = [10, 35, 25, 10, 0, 20];
const ITEM_WEIGHTS_BACK = [30, 5, 5, 30, 20, 10];
const ITEM_ORDER = [ItemKind.Rocket, ItemKind.Mine, ItemKind.Shield, ItemKind.Turbo, ItemKind.Emp, ItemKind.Repair];

/**
 * Authoritative, deterministic race simulation.
 *
 * `step(inputs)` advances exactly one fixed tick. Output depends only on the
 * seed, the config and the sequence of applied inputs/forfeits, which is
 * what makes replays verifiable. No wall-clock time is read here.
 */
export class RaceSimulation {
  readonly track: Track;
  readonly config: GameConfig;
  readonly cars: CarState[];
  readonly suspicion: SuspicionTracker[];
  readonly boxes: ItemBox[];
  readonly projectiles: Projectile[];
  readonly dt: number;
  readonly tickRate: number;
  readonly raceStartTick: number;
  tick = 0;
  phase: Phase = Phase.Countdown;
  endReason: RaceEndReason | null = null;
  private readonly physics: PhysicsWorld;
  private readonly rng: Rng;
  private nextProjectileId = 1;
  private graceEndTick = -1;
  private readonly maxRaceTicks: number;
  private events: GameEvent[] = [];
  private readonly prev: KinematicSample[];
  /** Turbo as the integrator saw it this tick (an EMP later in the tick can cancel it). */
  private readonly turboUsed: boolean[] = [];

  constructor(opts: SimulationOptions) {
    this.track = opts.track;
    this.config = opts.config;
    this.tickRate = opts.config.net.tickRate;
    this.dt = 1 / this.tickRate;
    this.rng = new Rng(opts.seed);
    this.physics = new PhysicsWorld(opts.rapier, opts.track, opts.config.car.radius);
    this.raceStartTick = secondsToTicks(opts.config.race.countdownSeconds, this.tickRate);
    this.maxRaceTicks = secondsToTicks(opts.config.race.maxRaceSeconds, this.tickRate);
    this.cars = [];
    this.suspicion = [];
    this.prev = [];
    for (let slot = 0; slot < opts.slots; slot++) {
      const pose = opts.track.gridPose(slot);
      const car = createCar(slot, pose.x, pose.y, pose.heading, opts.config.car.maxHealth, opts.config.items.bolt.maxAmmo, opts.config.car.maxSpeed);
      const proj0 = opts.track.project(pose.x, pose.y);
      car.segmentHint = proj0.segment;
      car.trackS = proj0.s;
      this.cars.push(car);
      this.suspicion.push(new SuspicionTracker(opts.config.antiCheat, this.tickRate));
      this.prev.push({ x: car.x, y: car.y, heading: car.heading, vx: 0, vy: 0, z: 0, vz: 0, spin: 0 });
      this.physics.addCar(slot, car.x, car.y);
    }
    this.boxes = opts.track.boxes.map((b) => ({ x: b.x, y: b.y, respawnTick: 0 }));
    this.projectiles = Array.from({ length: MAX_PROJECTILES }, () => ({
      active: false, id: 0, kind: ProjectileKind.Bolt, owner: 0, x: 0, y: 0, heading: 0, speed: 0, ttl: 0, age: 0, target: -1,
    }));
    rankCars(this.cars);
  }

  get raceTick(): number {
    return this.tick - this.raceStartTick;
  }

  /** Active projectiles, for bots that dodge by jumping. */
  activeProjectiles(): Projectile[] {
    return this.projectiles.filter((p) => p.active);
  }

  /** Events produced since the last call. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Permanently removes a car from the race (left the match, kicked). */
  forfeit(slot: number, reason: "left" | "timeout" | "kicked"): void {
    const car = this.cars[slot];
    if (!car || car.forfeited) return;
    car.forfeited = true;
    car.vx = 0;
    car.vy = 0;
    this.emit({ type: "forfeit", tick: this.tick, slot, reason });
    rankCars(this.cars);
  }

  setDisconnected(slot: number, disconnected: boolean): void {
    const car = this.cars[slot];
    if (car) car.disconnected = disconnected;
  }

  /** Ends the race immediately (e.g. every human left). */
  abort(reason: RaceEndReason): void {
    if (this.phase === Phase.Finished) return;
    this.finishRace(reason);
  }

  /** Records an anomaly detected outside the simulation (network layer). */
  reportAnomaly(slot: number, kind: AnomalyKind, detail: string): void {
    const tracker = this.suspicion[slot];
    if (!tracker) return;
    const r = tracker.report(kind, this.tick, detail);
    this.emit({ type: "anomaly", tick: this.tick, slot, kind, points: r.points, level: r.level, detail });
  }

  /** Advances one fixed tick. `inputs[slot]` is the button mask applied this tick. */
  step(inputs: ArrayLike<number>): void {
    if (this.phase === Phase.Finished) return;
    this.tick++;
    if (this.phase === Phase.Countdown) {
      const ticksLeft = this.raceStartTick - this.tick;
      if (ticksLeft > 0 && ticksLeft % this.tickRate === 0) {
        this.emit({ type: "countdown", tick: this.tick, secondsLeft: ticksLeft / this.tickRate });
      }
      if (ticksLeft <= 0) {
        this.phase = Phase.Racing;
        this.emit({ type: "race_start", tick: this.tick });
        for (const car of this.cars) car.lapStartTick = this.tick;
      }
      for (const car of this.cars) car.lastButtons = inputs[car.slot] ?? 0;
      return;
    }

    const dt = this.dt;
    for (const car of this.cars) {
      if (car.forfeited) continue;
      car.impulseThisTick = false;
      car.respawnedThisTick = false;
      const buttons = car.disconnected ? 0 : (inputs[car.slot] ?? 0) & BTN_MASK;
      this.tickTimers(car);
      this.handleActions(car, buttons);
      const surface = this.track.surfaceUnder(car.x, car.y, car.heading, car.segmentHint);
      car.surfaceSlope = surface.slope;
      this.turboUsed[car.slot] = car.turboTicks > 0;
      if (integrateMovement(car, buttons, dt, this.config, car.lastButtons, surface)) {
        this.emit({ type: "jump", tick: this.tick, slot: car.slot });
      }
      car.lastButtons = buttons;
    }

    for (const car of this.cars) {
      if (car.forfeited || car.wreckTicks > 0) continue;
      const res = this.physics.moveCar(car.slot, car.x, car.y, car.vx * dt, car.vy * dt);
      car.x = res.x;
      car.y = res.y;
      if (res.hitWall) {
        const impulse = applyWallImpact(car, res.nx, res.ny, this.config, dt);
        if (impulse > 0) car.impulseThisTick = true;
        if (impulse > 4) this.emit({ type: "collision", tick: this.tick, slot: car.slot, other: "wall", impulse });
      }
    }

    this.resolveCarCollisions();

    for (const car of this.cars) {
      if (car.forfeited) continue;
      this.validate(car);
    }

    for (const car of this.cars) {
      if (car.forfeited) continue;
      this.updateRace(car);
    }

    this.updateBoxes();
    this.updateProjectiles();
    for (const car of this.cars) if (!car.forfeited) this.commitBaseline(car);
    rankCars(this.cars);
    for (const tracker of this.suspicion) tracker.decay(dt);
    this.checkRaceEnd();
  }

  // ---------------------------------------------------------------- actions

  private tickTimers(car: CarState): void {
    if (car.turboTicks > 0) car.turboTicks--;
    if (car.stunTicks > 0) car.stunTicks--;
    if (car.empTicks > 0) car.empTicks--;
    if (car.itemLockTicks > 0) car.itemLockTicks--;
    if (car.shieldTicks > 0) car.shieldTicks--;
    if (car.spawnProtectTicks > 0) car.spawnProtectTicks--;
    if (car.boltCooldownTicks > 0) car.boltCooldownTicks--;
    if (car.itemCooldownTicks > 0) car.itemCooldownTicks--;
    if (car.wreckTicks > 0) {
      car.wreckTicks--;
      if (car.wreckTicks === 0) this.respawn(car);
    }
  }

  private handleActions(car: CarState, buttons: number): void {
    if (this.phase !== Phase.Racing || car.finished) return;
    const pressedUse = (buttons & BTN.USE_ITEM) !== 0 && (car.lastButtons & BTN.USE_ITEM) === 0;
    if (pressedUse) this.tryUseItem(car);
    if ((buttons & BTN.FIRE) !== 0) this.tryFire(car);
  }

  /** Server-side item activation. Every precondition is checked here. */
  tryUseItem(car: CarState): boolean {
    const reject = (reason: ItemRejectReason) => {
      this.emit({ type: "item_rejected", tick: this.tick, slot: car.slot, item: car.item, reason });
      return false;
    };
    if (this.phase !== Phase.Racing) return reject("not_racing");
    if (car.forfeited || car.finished || car.wreckTicks > 0 || car.stunTicks > 0 || car.flipTicks > 0) return reject("disabled");
    if (car.item === ItemKind.None) return reject("no_item");
    if (car.itemLockTicks > 0) return reject("item_locked");
    if (car.itemCooldownTicks > 0) return reject("cooldown");

    const item = car.item;
    let target: number | undefined;
    switch (item) {
      case ItemKind.Rocket: {
        const t = this.carAhead(car, ROCKET_TARGET_RANGE);
        this.spawnProjectile(ProjectileKind.Rocket, car, this.config.items.rocket.speed, this.config.items.rocket.lifetime, t?.slot ?? -1);
        target = t?.slot;
        break;
      }
      case ItemKind.Mine: {
        if (car.activeMines >= this.config.items.mine.maxActivePerPlayer) return reject("mine_limit");
        const m = this.spawnProjectile(ProjectileKind.Mine, car, 0, this.config.items.mine.lifetime, -1);
        if (!m) return reject("disabled");
        const off = this.config.items.mine.dropOffset;
        m.x = car.x - Math.cos(car.heading) * off;
        m.y = car.y - Math.sin(car.heading) * off;
        car.activeMines++;
        break;
      }
      case ItemKind.Shield:
        car.shieldTicks = secondsToTicks(this.config.items.shield.duration, this.tickRate);
        break;
      case ItemKind.Turbo:
        car.turboTicks = secondsToTicks(this.config.items.turbo.duration, this.tickRate);
        break;
      case ItemKind.Emp: {
        const t = this.carAhead(car, this.config.items.emp.range);
        if (!t) return reject("no_target");
        target = t.slot;
        const blocked = t.shieldTicks > 0 || t.spawnProtectTicks > 0;
        if (!blocked) {
          t.empTicks = secondsToTicks(this.config.items.emp.controlDuration, this.tickRate);
          t.itemLockTicks = secondsToTicks(this.config.items.emp.itemLockDuration, this.tickRate);
          t.turboTicks = 0;
        }
        this.emit({ type: "hit", tick: this.tick, source: "emp", attacker: car.slot, victim: t.slot, damage: 0, blocked });
        break;
      }
      case ItemKind.Repair:
        car.hp = Math.min(this.config.car.maxHealth, car.hp + this.config.items.repair.amount);
        break;
      default:
        return reject("no_item");
    }
    car.item = ItemKind.None;
    car.itemCooldownTicks = secondsToTicks(this.config.items.globalItemCooldown, this.tickRate);
    this.emit({ type: "item_used", tick: this.tick, slot: car.slot, item, ...(target !== undefined ? { target } : {}) });
    return true;
  }

  /** Primary weapon. Cooldown and ammo are enforced in ticks on the server. */
  tryFire(car: CarState): boolean {
    if (this.phase !== Phase.Racing || car.finished || car.forfeited) return false;
    if (car.wreckTicks > 0 || car.stunTicks > 0 || car.flipTicks > 0) return false;
    if (car.boltCooldownTicks > 0 || car.ammo <= 0) return false;
    const bolt = this.config.items.bolt;
    if (!this.spawnProjectile(ProjectileKind.Bolt, car, bolt.speed, bolt.lifetime, -1)) return false;
    car.ammo--;
    car.boltCooldownTicks = secondsToTicks(bolt.cooldown, this.tickRate);
    this.emit({ type: "fire", tick: this.tick, slot: car.slot, ammoLeft: car.ammo });
    return true;
  }

  /** The car directly ahead in the race order, if it is within range. */
  private carAhead(car: CarState, range: number): CarState | null {
    let best: CarState | null = null;
    for (const other of this.cars) {
      if (other.slot === car.slot || other.forfeited || other.finished || other.wreckTicks > 0) continue;
      if (other.progress <= car.progress) continue;
      if (Math.hypot(other.x - car.x, other.y - car.y) > range) continue;
      if (!best || other.progress < best.progress) best = other;
    }
    return best;
  }

  private spawnProjectile(kind: ProjectileKind, car: CarState, speed: number, lifetime: number, target: number): Projectile | null {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return null;
    const nose = this.config.car.radius + 0.6;
    p.active = true;
    p.id = this.nextProjectileId = (this.nextProjectileId % 65535) + 1;
    p.kind = kind;
    p.owner = car.slot;
    p.heading = car.heading;
    p.x = car.x + Math.cos(car.heading) * nose;
    p.y = car.y + Math.sin(car.heading) * nose;
    p.speed = speed + Math.max(0, car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading)) * (kind === ProjectileKind.Mine ? 0 : 1);
    p.ttl = secondsToTicks(lifetime, this.tickRate);
    p.age = 0;
    p.target = target;
    return p;
  }

  // ---------------------------------------------------------------- physics helpers

  /**
   * Car-on-car contacts: capsule shapes, separation through the physics world
   * (so nobody is pushed into a wall), then an impulse with momentum exchange,
   * spin from off-centre hits, traction loss and body roll (impact.ts).
   */
  private resolveCarCollisions(): void {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i]!;
      if (!this.collidable(a)) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j]!;
        if (!this.collidable(b)) continue;
        // A car high enough in the air passes over another one.
        if (Math.abs(a.z - b.z) >= this.config.car.bodyHeight) continue;
        const contact = carContact(a, b, this.config);
        if (!contact) continue;
        const { nx, ny, depth } = contact;
        // The heavier car (turbo ram) gives way less.
        const ma = carMass(a, this.config);
        const mb = carMass(b, this.config);
        const shareA = mb / (ma + mb);
        const ra = this.physics.moveCar(a.slot, a.x, a.y, -nx * depth * shareA, -ny * depth * shareA);
        const rb = this.physics.moveCar(b.slot, b.x, b.y, nx * depth * (1 - shareA), ny * depth * (1 - shareA));
        const impulse = resolveCarImpact(a, b, contact, this.config, this.dt);
        a.x = ra.x; a.y = ra.y;
        b.x = rb.x; b.y = rb.y;
        if (impulse > 2) this.emit({ type: "collision", tick: this.tick, slot: a.slot, other: b.slot, impulse });
        a.impulseThisTick = true;
        b.impulseThisTick = true;
      }
    }
  }

  /** Finished, wrecked and forfeited cars are ghosts: no blocking, no damage. */
  private collidable(car: CarState): boolean {
    return !car.forfeited && !car.finished && car.wreckTicks === 0;
  }

  private validate(car: CarState): void {
    const prev = this.prev[car.slot]!;
    const verdict = validateMovement(prev, car, {
      dt: this.dt,
      config: this.config,
      track: this.track,
      turbo: car.turboTicks > 0 || this.turboUsed[car.slot] === true,
      impulse: car.impulseThisTick,
      respawned: car.respawnedThisTick,
      prevSpeedCap: car.speedCap,
      segmentHint: car.segmentHint,
      // Gravity on a downhill grade is a legal source of acceleration.
      extraAcceleration: this.config.car.gravity * this.config.car.slopeFactor * Math.max(0, -car.surfaceSlope),
    });
    for (const v of verdict.violations) this.reportAnomaly(car.slot, v.kind, v.detail);
    if (verdict.corrected) {
      car.x = verdict.corrected.x;
      car.y = verdict.corrected.y;
      car.heading = verdict.corrected.heading;
      car.vx = verdict.corrected.vx;
      car.vy = verdict.corrected.vy;
      car.z = verdict.corrected.z ?? car.z;
      car.vz = verdict.corrected.vz ?? car.vz;
      car.spin = verdict.corrected.spin ?? car.spin;
      this.physics.setCarPosition(car.slot, car.x, car.y);
    }
    if (verdict.respawn) this.respawn(car);
  }

  /**
   * Server-side placement (tests, admin tools). Also moves the anti-cheat
   * baseline, so it is not reported as a teleport. Never reachable from clients.
   */
  placeCar(slot: number, x: number, y: number, heading: number): void {
    const car = this.cars[slot];
    if (!car) return;
    car.x = x;
    car.y = y;
    car.heading = heading;
    const p = this.track.project(x, y);
    car.segmentHint = p.segment;
    car.trackS = p.s;
    this.physics.setCarPosition(slot, x, y);
    this.commitBaseline(car);
  }

  /** The validated end-of-tick state becomes the baseline for the next tick's checks. */
  private commitBaseline(car: CarState): void {
    const p = this.prev[car.slot]!;
    p.x = car.x;
    p.y = car.y;
    p.heading = car.heading;
    p.vx = car.vx;
    p.vy = car.vy;
    p.z = car.z;
    p.vz = car.vz;
    p.spin = car.spin;
  }

  // ---------------------------------------------------------------- race

  private updateRace(car: CarState): void {
    const prev = this.prev[car.slot]!;
    if (this.phase === Phase.Racing && !car.finished && !car.respawnedThisTick) {
      const result = processGates(car, prev.x, prev.y, this.track, this.config.race.laps, this.tick);
      if (result.kind === "passed") {
        this.emit({ type: "checkpoint", tick: this.tick, slot: car.slot, gate: result.gate, lap: car.lap });
        if (result.lapCompleted) {
          this.emit({ type: "lap", tick: this.tick, slot: car.slot, lap: car.lap - (result.finished ? 0 : 1), lapTicks: this.tick - car.lapStartTick });
          car.lapStartTick = this.tick;
          car.ammo = this.config.items.bolt.maxAmmo;
        }
        if (result.finished) {
          rankCars(this.cars);
          this.emit({ type: "finish", tick: this.tick, slot: car.slot, rank: car.rank, raceTicks: this.tick - this.raceStartTick });
          if (this.graceEndTick < 0) this.graceEndTick = this.tick + secondsToTicks(this.config.race.finishGraceSeconds, this.tickRate);
        }
      } else if (result.kind === "skip") {
        this.reportAnomaly(car.slot, "checkpoint_skip", `crossed gate ${result.gate}, expected ${result.expected}`);
      }
    }

    const proj = this.track.project(car.x, car.y, car.segmentHint);
    const prevProgress = car.progress;
    const prevS = car.trackS;
    car.segmentHint = proj.segment;
    car.trackS = proj.s;
    // Ramp lips launch grounded cars that hit them fast enough (same take-off speed rules as a jump).
    if (!car.respawnedThisTick && car.z === 0 && car.vz === 0 && car.wreckTicks === 0 && this.track.rampCrossed(prevS, proj.s)) {
      const forward = car.vx * proj.tangentX + car.vy * proj.tangentY;
      if (forward >= this.config.car.rampMinSpeed) {
        car.vz = Math.min(this.config.car.rampVelocity, this.config.car.jumpVelocity);
        this.emit({ type: "jump", tick: this.tick, slot: car.slot });
      }
    }
    car.progress = computeProgress(car, this.track, proj.s);
    const maxStep = absoluteSpeedCeiling(this.config) * this.dt * this.config.antiCheat.progressJumpFactor + 0.5;
    if (!car.respawnedThisTick && car.progress - prevProgress > maxStep && prevProgress !== 0) {
      this.reportAnomaly(car.slot, "progress_jump", `progress +${(car.progress - prevProgress).toFixed(1)}m`);
      car.progress = prevProgress;
    }

    // Wrong-way warning (cosmetic for the HUD, no penalty).
    const along = Math.cos(car.heading) * proj.tangentX + Math.sin(car.heading) * proj.tangentY;
    if (along < -0.3 && speedOf(car) > 3 && !car.finished) car.wrongWayTicks++;
    else car.wrongWayTicks = 0;
    car.wrongWay = car.wrongWayTicks > secondsToTicks(this.config.race.wrongWaySeconds, this.tickRate);
  }

  /** Puts a car back at its last checkpoint (or the grid) with full health. */
  respawn(car: CarState): void {
    const gate = car.lastGate >= 0 ? this.track.gates[car.lastGate]! : null;
    const pose = gate ? this.track.poseAt(gate.s + 2) : this.track.gridPose(car.slot);
    car.x = pose.x;
    car.y = pose.y;
    car.heading = pose.heading;
    car.vx = 0;
    car.vy = 0;
    car.z = 0;
    car.vz = 0;
    car.yawRate = 0;
    this.settle(car);
    car.speedCap = this.config.car.maxSpeed;
    car.hp = this.config.car.maxHealth;
    car.stunTicks = 0;
    car.empTicks = 0;
    car.turboTicks = 0;
    car.wreckTicks = 0;
    car.spawnProtectTicks = secondsToTicks(this.config.race.respawnProtectionSeconds, this.tickRate);
    car.respawnedThisTick = true;
    const p = this.track.project(car.x, car.y);
    car.segmentHint = p.segment;
    car.trackS = p.s;
    this.physics.setCarPosition(car.slot, car.x, car.y);
    this.emit({ type: "respawn", tick: this.tick, slot: car.slot });
  }

  /** Clears every impact effect (respawn, wreck). */
  private settle(car: CarState): void {
    car.spin = 0;
    car.tractionTicks = 0;
    car.flipTicks = 0;
    car.roll = 0;
    car.rollRate = 0;
    car.pitch = 0;
    car.pitchRate = 0;
  }

  // ---------------------------------------------------------------- items

  private updateBoxes(): void {
    if (this.phase !== Phase.Racing) return;
    const reach = this.config.items.boxRadius + this.config.car.radius;
    const reachSq = reach * reach;
    this.boxes.forEach((box, index) => {
      if (box.respawnTick > this.tick) return;
      for (const car of this.cars) {
        if (car.forfeited || car.finished || car.wreckTicks > 0 || car.item !== ItemKind.None) continue;
        const dx = car.x - box.x;
        const dy = car.y - box.y;
        if (dx * dx + dy * dy > reachSq) continue;
        car.item = this.rollItem(car);
        box.respawnTick = this.tick + secondsToTicks(this.config.items.boxRespawn, this.tickRate);
        this.emit({ type: "pickup", tick: this.tick, slot: car.slot, item: car.item, box: index });
        return;
      }
    });
  }

  /** Rank-weighted roll: leaders get defensive items, the back of the pack gets catch-up tools. */
  private rollItem(car: CarState): ItemKind {
    const active = this.cars.filter((c) => !c.forfeited).length;
    const f = active > 1 ? clamp((car.rank - 1) / (active - 1), 0, 1) : 0;
    const weights = ITEM_WEIGHTS_FRONT.map((w, i) => w + (ITEM_WEIGHTS_BACK[i]! - w) * f);
    if (car.hp >= this.config.car.maxHealth * 0.9) weights[5] = 0;
    return ITEM_ORDER[this.rng.weighted(weights)]!;
  }

  private updateProjectiles(): void {
    const dt = this.dt;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.age++;
      p.ttl--;
      if (p.ttl <= 0) {
        this.removeProjectile(p);
        continue;
      }
      if (p.kind === ProjectileKind.Mine) {
        this.checkMine(p);
        continue;
      }
      if (p.kind === ProjectileKind.Rocket) this.steerRocket(p);
      const dx = Math.cos(p.heading) * p.speed * dt;
      const dy = Math.sin(p.heading) * p.speed * dt;
      const stepLen = Math.hypot(dx, dy);
      const wall = this.physics.raycastWall(p.x, p.y, dx, dy, stepLen);
      const travel = wall ? wall.distance : stepLen;
      const ex = p.x + (dx / stepLen) * travel;
      const ey = p.y + (dy / stepLen) * travel;
      const victim = this.sweepHit(p, p.x, p.y, ex, ey);
      if (victim) {
        this.projectileHit(p, victim);
        this.removeProjectile(p);
        continue;
      }
      p.x = ex;
      p.y = ey;
      if (wall) this.removeProjectile(p);
    }
  }

  private steerRocket(p: Projectile): void {
    const cfg = this.config.items.rocket;
    let aimX: number;
    let aimY: number;
    const target = p.target >= 0 ? this.cars[p.target] : undefined;
    if (target && this.collidable(target) && this.physics.lineOfSight(p.x, p.y, target.x, target.y)) {
      aimX = target.x;
      aimY = target.y;
    } else {
      // Follow the racing line when the target is out of sight.
      const proj = this.track.project(p.x, p.y);
      const ahead = this.track.poseAt(proj.s + 18);
      aimX = ahead.x;
      aimY = ahead.y;
    }
    const desired = Math.atan2(aimY - p.y, aimX - p.x);
    const maxTurn = cfg.turnRate * this.dt;
    p.heading += clamp(angleDelta(p.heading, desired), -maxTurn, maxTurn);
  }

  private sweepHit(p: Projectile, x0: number, y0: number, x1: number, y1: number): CarState | null {
    const hitRadius = p.kind === ProjectileKind.Rocket ? this.config.items.rocket.hitRadius : this.config.items.bolt.hitRadius;
    const reach = hitRadius + this.config.car.radius;
    const armTicks = secondsToTicks(this.config.items.rocket.armTime, this.tickRate);
    let best: CarState | null = null;
    let bestD = Infinity;
    for (const car of this.cars) {
      if (!this.collidable(car)) continue;
      // Shots fly at bumper height: a jumping car lets them pass underneath.
      if (car.z > SHOT_HEIGHT) continue;
      if (car.slot === p.owner && (p.kind === ProjectileKind.Bolt || p.age < armTicks * 4)) continue;
      const d = pointSegmentDistSq(car.x, car.y, x0, y0, x1, y1);
      if (d <= reach * reach && d < bestD) {
        best = car;
        bestD = d;
      }
    }
    return best;
  }

  private checkMine(p: Projectile): void {
    const cfg = this.config.items.mine;
    if (p.age < secondsToTicks(cfg.armTime, this.tickRate)) return;
    const reach = cfg.triggerRadius + this.config.car.radius;
    const ownerImmune = p.age < secondsToTicks(1.5, this.tickRate);
    for (const car of this.cars) {
      if (!this.collidable(car)) continue;
      if (car.z > MINE_TRIGGER_HEIGHT) continue;
      if (car.slot === p.owner && ownerImmune) continue;
      const dx = car.x - p.x;
      const dy = car.y - p.y;
      if (dx * dx + dy * dy <= reach * reach) {
        this.projectileHit(p, car);
        this.removeProjectile(p);
        return;
      }
    }
  }

  private projectileHit(p: Projectile, victim: CarState): void {
    const items = this.config.items;
    const source: ProjectileSource = p.kind === ProjectileKind.Rocket ? "rocket" : p.kind === ProjectileKind.Mine ? "mine" : "bolt";
    const damage = source === "rocket" ? items.rocket.damage : source === "mine" ? items.mine.damage : items.bolt.damage;
    const blocked = victim.shieldTicks > 0 || victim.spawnProtectTicks > 0;
    this.emit({ type: "hit", tick: this.tick, source, attacker: p.owner, victim: victim.slot, damage: blocked ? 0 : damage, blocked });
    if (blocked) return;
    victim.hp -= damage;
    if (source === "bolt") {
      victim.vx *= items.bolt.slowFactor;
      victim.vy *= items.bolt.slowFactor;
    } else {
      const stun = source === "rocket" ? items.rocket.stun : items.mine.stun;
      victim.stunTicks = Math.max(victim.stunTicks, secondsToTicks(stun, this.tickRate));
      victim.turboTicks = 0;
      // Knockback along the projectile direction, bounded by the speed ceiling.
      const kick = source === "rocket" ? 7 : 4;
      const kx = p.kind === ProjectileKind.Mine ? victim.vx : Math.cos(p.heading);
      const ky = p.kind === ProjectileKind.Mine ? victim.vy : Math.sin(p.heading);
      const kl = Math.hypot(kx, ky) || 1;
      const vx0 = victim.vx;
      const vy0 = victim.vy;
      victim.vx = victim.vx * 0.35 + (kx / kl) * kick;
      victim.vy = victim.vy * 0.35 + (ky / kl) * kick;
      victim.impulseThisTick = true;
      const dvx = victim.vx - vx0;
      const dvy = victim.vy - vy0;
      if (source === "rocket") {
        // The blast hits where the rocket is: off-centre hits spin the car as it rolls over.
        const rx = p.x - victim.x;
        const ry = p.y - victim.y;
        const max = this.config.impact.maxSpin;
        const dSpin = clamp(((rx * ky - ry * kx) / kl) * kick / this.config.impact.yawInertia, -max, max);
        victim.spin = clamp(victim.spin + dSpin, -max, max);
        applyKnock(victim, dvx, dvy, dSpin, this.config, this.dt, true);
      } else {
        // A mine goes off under the car: it pops up and lurches.
        applyKnock(victim, dvx, dvy, 0, this.config, this.dt);
        if (victim.z === 0 && victim.vz === 0) victim.vz = Math.min(this.config.impact.mineHop, this.config.car.jumpVelocity);
      }
    }
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.wreckTicks = secondsToTicks(this.config.race.wreckSeconds, this.tickRate);
      victim.vx = 0;
      victim.vy = 0;
      this.settle(victim);
      victim.impulseThisTick = true;
      this.emit({ type: "wreck", tick: this.tick, slot: victim.slot, by: p.owner === victim.slot ? null : p.owner });
    }
  }

  private removeProjectile(p: Projectile): void {
    if (p.kind === ProjectileKind.Mine) {
      const owner = this.cars[p.owner];
      if (owner && owner.activeMines > 0) owner.activeMines--;
    }
    p.active = false;
  }

  // ---------------------------------------------------------------- end of race

  private checkRaceEnd(): void {
    if (this.phase !== Phase.Racing) return;
    const racing = this.cars.filter((c) => !c.forfeited);
    if (racing.length > 0 && racing.every((c) => c.finished)) return this.finishRace("all_finished");
    if (this.graceEndTick >= 0 && this.tick >= this.graceEndTick) return this.finishRace("grace_expired");
    if (this.raceTick >= this.maxRaceTicks) return this.finishRace("time_limit");
  }

  private finishRace(reason: RaceEndReason): void {
    this.phase = Phase.Finished;
    this.endReason = reason;
    rankCars(this.cars);
    this.emit({ type: "race_end", tick: this.tick, reason });
  }

  results(): CarResult[] {
    return [...this.cars]
      .sort((a, b) => a.rank - b.rank)
      .map((car) => ({
        slot: car.slot,
        rank: car.rank,
        status: car.forfeited ? "forfeit" : car.finished ? "finished" : "dnf",
        finishTicks: car.finished ? car.finishTick - this.raceStartTick : null,
        lapsCompleted: car.finished ? this.config.race.laps : Math.max(0, car.lap - 1),
        progress: car.progress,
      }));
  }

  // ---------------------------------------------------------------- snapshots

  carFlags(car: CarState): number {
    let f = 0;
    if (car.shieldTicks > 0) f |= CAR_FLAG.SHIELD;
    if (car.turboTicks > 0) f |= CAR_FLAG.TURBO;
    if (car.stunTicks > 0) f |= CAR_FLAG.STUNNED;
    if (car.empTicks > 0) f |= CAR_FLAG.EMP;
    if (car.wreckTicks > 0) f |= CAR_FLAG.WRECKED;
    if (car.finished) f |= CAR_FLAG.FINISHED;
    if (car.disconnected) f |= CAR_FLAG.DISCONNECTED;
    if (car.wrongWay) f |= CAR_FLAG.WRONG_WAY;
    if (car.drifting) f |= CAR_FLAG.DRIFTING;
    if (car.itemLockTicks > 0) f |= CAR_FLAG.ITEM_LOCKED;
    if (car.forfeited) f |= CAR_FLAG.FORFEITED;
    if (car.spawnProtectTicks > 0) f |= CAR_FLAG.SPAWN_PROTECTED;
    if (car.z > 0) f |= CAR_FLAG.AIRBORNE;
    return f;
  }

  snapshot(ack = 0): Snapshot {
    return {
      phase: this.phase,
      tick: this.tick,
      raceTick: this.raceTick,
      ack,
      cars: this.cars
        .filter((c) => !c.forfeited)
        .map((c) => ({
          slot: c.slot,
          x: c.x,
          y: c.y,
          heading: c.heading,
          vx: c.vx,
          vy: c.vy,
          z: c.z,
          vz: c.vz,
          hp: c.hp,
          flags: this.carFlags(c),
          item: c.item,
          ammo: c.ammo,
          lap: c.lap,
          nextGate: c.nextGate,
          rank: c.rank,
          turboTicks: c.turboTicks,
          stunTicks: c.stunTicks,
          empTicks: c.empTicks,
          shieldTicks: c.shieldTicks,
          jumpCooldownTicks: c.jumpCooldownTicks,
          spin: c.spin,
          roll: c.roll,
          rollRate: c.rollRate,
          pitch: c.pitch,
          pitchRate: c.pitchRate,
          tractionTicks: c.tractionTicks,
          flipTicks: c.flipTicks,
        })),
      projectiles: this.projectiles
        .filter((p) => p.active)
        .map((p) => ({ id: p.id, kind: p.kind, owner: p.owner, x: p.x, y: p.y, heading: p.heading })),
      boxes: this.boxes.map((b) => b.respawnTick <= this.tick),
    };
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }

  dispose(): void {
    this.physics.dispose();
  }
}
