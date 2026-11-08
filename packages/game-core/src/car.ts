import { ItemKind } from "@rc/shared";

/**
 * Complete server-side state of one car. The client never writes any of
 * this; it receives a quantised subset in snapshots.
 */
export interface CarState {
  slot: number;
  // kinematics
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  jumpCooldownTicks: number;
  yawRate: number;
  /** Current legal speed ceiling; decays back to base after turbo/knockback. */
  speedCap: number;
  drifting: boolean;
  // combat
  hp: number;
  item: ItemKind;
  ammo: number;
  turboTicks: number;
  stunTicks: number;
  empTicks: number;
  itemLockTicks: number;
  shieldTicks: number;
  spawnProtectTicks: number;
  wreckTicks: number;
  boltCooldownTicks: number;
  itemCooldownTicks: number;
  activeMines: number;
  /** Set when an external impulse (hit, bump, respawn) moved the car this tick. */
  impulseThisTick: boolean;
  respawnedThisTick: boolean;
  // race
  lap: number;
  nextGate: number;
  gatesPassed: number;
  lastGateTick: number;
  lapStartTick: number;
  lastGate: number;
  finished: boolean;
  finishTick: number;
  rank: number;
  progress: number;
  segmentHint: number;
  wrongWayTicks: number;
  wrongWay: boolean;
  // session
  forfeited: boolean;
  disconnected: boolean;
  lastButtons: number;
}

export function createCar(slot: number, x: number, y: number, heading: number, maxHealth: number, maxAmmo: number, maxSpeed: number): CarState {
  return {
    slot,
    x,
    y,
    heading,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    jumpCooldownTicks: 0,
    yawRate: 0,
    speedCap: maxSpeed,
    drifting: false,
    hp: maxHealth,
    item: ItemKind.None,
    ammo: maxAmmo,
    turboTicks: 0,
    stunTicks: 0,
    empTicks: 0,
    itemLockTicks: 0,
    shieldTicks: 0,
    spawnProtectTicks: 0,
    wreckTicks: 0,
    boltCooldownTicks: 0,
    itemCooldownTicks: 0,
    activeMines: 0,
    impulseThisTick: false,
    respawnedThisTick: false,
    lap: 0,
    nextGate: 0,
    gatesPassed: 0,
    lastGateTick: 0,
    lapStartTick: 0,
    lastGate: -1,
    finished: false,
    finishTick: -1,
    rank: slot + 1,
    progress: 0,
    segmentHint: -1,
    wrongWayTicks: 0,
    wrongWay: false,
    forfeited: false,
    disconnected: false,
    lastButtons: 0,
  };
}

export function speedOf(car: { vx: number; vy: number }): number {
  return Math.hypot(car.vx, car.vy);
}

/** Cars that still take part in the race simulation. */
export function isActive(car: CarState): boolean {
  return !car.forfeited;
}
