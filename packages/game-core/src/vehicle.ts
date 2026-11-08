import { BTN, type GameConfig } from "@rc/shared";
import { clamp } from "./math.js";

/** Subset of car state the movement model reads and writes. */
export interface MovementState {
  heading: number;
  vx: number;
  vy: number;
  yawRate: number;
  speedCap: number;
  drifting: boolean;
  turboTicks: number;
  stunTicks: number;
  empTicks: number;
  wreckTicks: number;
  finished: boolean;
}

export interface MovementLimits {
  maxSpeed: number;
  acceleration: number;
  maxYawRate: number;
}

/** Yaw acceleration in rad/s²; keeps steering responsive but not instant. */
const YAW_ACCELERATION = 16;
/** How fast over-cap speed (after turbo or a knockback) bleeds off, m/s². */
export const OVERSPEED_DECAY = 14;

/**
 * Speed/acceleration/yaw ceilings for a car right now. Shared by the
 * integrator (which never exceeds them) and the anti-cheat validator (which
 * checks them with tolerance).
 */
export function movementLimits(car: Pick<MovementState, "turboTicks" | "drifting">, config: GameConfig): MovementLimits {
  const c = config.car;
  const turbo = car.turboTicks > 0;
  const maxSpeed = c.maxSpeed * (turbo ? config.items.turbo.speedMultiplier : 1) * (car.drifting ? c.driftSpeedMultiplier : 1);
  return {
    maxSpeed,
    acceleration: c.acceleration * (turbo ? config.items.turbo.accelerationMultiplier : 1),
    maxYawRate: c.maxYawRate * c.driftYawMultiplier,
  };
}

/** Absolute speed no car may ever exceed, including turbo and knockback. */
export function absoluteSpeedCeiling(config: GameConfig): number {
  return config.car.maxSpeed * config.items.turbo.speedMultiplier * 1.35;
}

/**
 * Arcade RC-car integrator. Deterministic, allocation-free. Updates velocity
 * and heading only; position is resolved by the physics world (walls).
 */
export function integrateMovement(car: MovementState, buttons: number, dt: number, config: GameConfig): void {
  const c = config.car;
  const controlsLocked = car.stunTicks > 0 || car.wreckTicks > 0;
  const autopilot = car.finished;
  const throttleBtn = !controlsLocked && !autopilot && (buttons & BTN.ACCELERATE) !== 0;
  const brakeBtn = !controlsLocked && !autopilot && (buttons & BTN.BRAKE) !== 0;
  const steer = controlsLocked || autopilot ? 0 : ((buttons & BTN.STEER_LEFT) !== 0 ? 1 : 0) - ((buttons & BTN.STEER_RIGHT) !== 0 ? 1 : 0);

  let fx = Math.cos(car.heading);
  let fy = Math.sin(car.heading);
  let vF = car.vx * fx + car.vy * fy;
  let vL = car.vx * -fy + car.vy * fx;

  car.drifting = !controlsLocked && (buttons & BTN.DRIFT) !== 0 && steer !== 0 && vF > 8;
  const limits = movementLimits(car, config);
  const empActive = car.empTicks > 0;
  const throttleCap = empActive ? config.items.emp.throttleCap : 1;
  const forwardCap = limits.maxSpeed * throttleCap;

  if (car.wreckTicks > 0) {
    vF = 0;
    vL = 0;
  } else if (throttleBtn && !brakeBtn) {
    if (vF < 0) vF = Math.min(0, vF + c.brakeDeceleration * dt);
    else if (vF < forwardCap) vF = Math.min(forwardCap, vF + limits.acceleration * dt);
  } else if (brakeBtn) {
    if (vF > 0.5) vF = Math.max(0, vF - c.brakeDeceleration * dt);
    else vF = Math.max(-c.maxReverseSpeed, vF - c.reverseAcceleration * dt);
  } else {
    const decel = (controlsLocked ? 2.2 : 1) * c.coastDeceleration * dt;
    vF = vF > 0 ? Math.max(0, vF - decel) : Math.min(0, vF + decel);
  }

  // Bleed off speed above the current ceiling smoothly (turbo ending, drifting).
  if (vF > forwardCap) vF = Math.max(forwardCap, vF - OVERSPEED_DECAY * dt);

  // Steering: needs some speed, loses authority at the top end, flips in reverse.
  const absF = Math.abs(vF);
  const speedFactor = clamp(absF / c.fullSteerSpeed, 0, 1) * (1 - c.highSpeedSteerLoss * clamp(absF / c.maxSpeed, 0, 1));
  const yawTarget =
    steer * c.maxYawRate * speedFactor * (car.drifting ? c.driftYawMultiplier : 1) * (empActive ? config.items.emp.steerScale : 1) * (vF < 0 ? -1 : 1);
  const maxYawStep = YAW_ACCELERATION * dt;
  car.yawRate += clamp(yawTarget - car.yawRate, -maxYawStep, maxYawStep);
  car.yawRate = clamp(car.yawRate, -limits.maxYawRate, limits.maxYawRate);

  // Velocity in world space before rotating the chassis.
  let vx = fx * vF - fy * vL;
  let vy = fy * vF + fx * vL;

  car.heading += car.yawRate * dt;
  if (car.heading > Math.PI) car.heading -= Math.PI * 2;
  else if (car.heading <= -Math.PI) car.heading += Math.PI * 2;

  // Tyres pull the velocity towards the new heading; drifting grips less.
  fx = Math.cos(car.heading);
  fy = Math.sin(car.heading);
  vF = vx * fx + vy * fy;
  vL = vx * -fy + vy * fx;
  vL *= Math.exp(-(car.drifting ? c.driftGrip : c.grip) * dt);
  vx = fx * vF - fy * vL;
  vy = fy * vF + fx * vL;

  // Hard ceiling: never faster than the legal cap.
  car.speedCap = Math.max(limits.maxSpeed, car.speedCap - OVERSPEED_DECAY * dt);
  const speed = Math.hypot(vx, vy);
  if (speed > car.speedCap) {
    const k = car.speedCap / speed;
    vx *= k;
    vy *= k;
  }
  car.vx = vx;
  car.vy = vy;
}

/**
 * Velocity response after the physics world stopped the car against a wall.
 * Removes the into-wall component with a small bounce and scrapes speed.
 */
export function applyWallResponse(car: { vx: number; vy: number }, nx: number, ny: number, config: GameConfig): number {
  const vn = car.vx * nx + car.vy * ny;
  if (vn >= 0) return 0;
  const e = config.car.wallRestitution;
  car.vx -= (1 + e) * vn * nx;
  car.vy -= (1 + e) * vn * ny;
  car.vx *= config.car.wallFriction;
  car.vy *= config.car.wallFriction;
  return -vn;
}
