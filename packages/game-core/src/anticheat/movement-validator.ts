import type { AnomalyKind, GameConfig } from "@rc/shared";
import { angleDelta, isFiniteNumber } from "../math.js";
import type { Track } from "../track.js";
import { absoluteSpeedCeiling, maxJumpHeight, movementLimits, OVERSPEED_DECAY } from "../vehicle.js";

export interface KinematicSample {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  /** Height and vertical speed; omitted means on the floor. */
  z?: number;
  vz?: number;
  /** Extra yaw rate from impacts (rad/s); omitted means none. */
  spin?: number;
}

export interface MovementContext {
  dt: number;
  config: GameConfig;
  track: Track;
  /** Turbo active at the start or end of the tick. */
  turbo: boolean;
  /** An external impulse (hit, car bump) legitimately changed velocity. */
  impulse: boolean;
  /** The car was respawned this tick; position jumps are expected. */
  respawned: boolean;
  /** Speed ceiling the car carried into this tick (decays after turbo/knockback). */
  prevSpeedCap: number;
  segmentHint?: number;
  /** Legal extra acceleration this tick (m/s²), e.g. gravity on a downhill grade. */
  extraAcceleration?: number;
}

export interface MovementViolation {
  kind: AnomalyKind;
  detail: string;
}

export interface MovementVerdict {
  violations: MovementViolation[];
  /** Corrected state to use instead of `next`, or null if `next` is legitimate. */
  corrected: KinematicSample | null;
  /** The car must be put back on the track at its last checkpoint. */
  respawn: boolean;
}

/**
 * Checks one simulated tick of movement against physical limits.
 *
 * The client cannot send positions, so in normal operation this never
 * fires. It is defence in depth against physics bugs, tunnelling, corrupted
 * state or exploits in other systems, and the same checks would apply if a
 * future mode accepted client-side physics. Limits carry tolerance so
 * floating-point noise and legitimate edge cases never trigger it.
 */
export function validateMovement(prev: KinematicSample, next: KinematicSample, ctx: MovementContext): MovementVerdict {
  const violations: MovementViolation[] = [];
  const { config, dt } = ctx;
  const ac = config.antiCheat;

  const values = [next.x, next.y, next.heading, next.vx, next.vy, next.z ?? 0, next.vz ?? 0, next.spin ?? 0];
  if (!values.every(isFiniteNumber)) {
    return { violations: [{ kind: "invalid_state", detail: "non-finite kinematics" }], corrected: null, respawn: true };
  }
  if (ctx.respawned) return { violations, corrected: null, respawn: false };

  const limits = movementLimits({ turboTicks: ctx.turbo ? 1 : 0, drifting: false }, config);
  const ceiling = absoluteSpeedCeiling(config);
  const prevSpeed = Math.hypot(prev.vx, prev.vy);
  const nextSpeed = Math.hypot(next.vx, next.vy);
  const out: KinematicSample = { ...next };
  let changed = false;
  const fix = (): KinematicSample => {
    changed = true;
    return out;
  };

  // Speed: within the legal cap (with tolerance). Over-cap speed is only legal
  // when it is decaying from a turbo/knockback ceiling or caused by an impulse.
  const legalCap = Math.max(limits.maxSpeed, ctx.prevSpeedCap) * (1 + ac.speedTolerance);
  const hardCap = ceiling * (1 + ac.speedTolerance);
  if (nextSpeed > hardCap || (!ctx.impulse && nextSpeed > legalCap)) {
    const allowed = ctx.impulse ? hardCap : Math.max(limits.maxSpeed, ctx.prevSpeedCap - OVERSPEED_DECAY * dt);
    violations.push({ kind: "speed", detail: `speed ${nextSpeed.toFixed(2)} > ${allowed.toFixed(2)}` });
    const k = allowed / nextSpeed;
    const c = fix();
    c.vx *= k;
    c.vy *= k;
  }

  // Acceleration: speed gain per tick bounded by engine power (impulses excused).
  if (!ctx.impulse) {
    const maxGain = (limits.acceleration + (ctx.extraAcceleration ?? 0)) * dt * (1 + ac.accelerationTolerance) + 1e-6;
    const gain = Math.hypot(out.vx, out.vy) - prevSpeed;
    if (gain > maxGain) {
      violations.push({ kind: "acceleration", detail: `gain ${(gain / dt).toFixed(2)} m/s² > ${(maxGain / dt).toFixed(2)}` });
      const c = fix();
      const s = Math.hypot(c.vx, c.vy);
      if (s > 0) {
        const k = (prevSpeed + maxGain) / s;
        c.vx *= k;
        c.vy *= k;
      }
    }
  }

  // Impact spin: bounded, and it can only grow on a tick with an impact (otherwise it only decays).
  const maxSpin = config.impact.maxSpin;
  const prevSpin = Math.min(Math.abs(prev.spin ?? 0), maxSpin);
  const nextSpin = next.spin ?? 0;
  if (Math.abs(nextSpin) > maxSpin * (1 + ac.rotationTolerance)) {
    violations.push({ kind: "rotation", detail: `spin ${nextSpin.toFixed(2)} rad/s > ${maxSpin}` });
    fix().spin = Math.sign(nextSpin) * maxSpin;
  } else if (!ctx.impulse && Math.abs(nextSpin) > prevSpin + 1e-6) {
    violations.push({ kind: "rotation", detail: `spin grew without an impact: ${prevSpin.toFixed(2)} → ${Math.abs(nextSpin).toFixed(2)}` });
    fix().spin = Math.sign(nextSpin) * prevSpin;
  }

  // Rotation: heading change per tick bounded by max yaw rate plus the spin carried into the tick.
  const maxYaw = (limits.maxYawRate + prevSpin) * dt * (1 + ac.rotationTolerance) + 1e-6;
  const dHeading = angleDelta(prev.heading, next.heading);
  if (Math.abs(dHeading) > maxYaw) {
    violations.push({ kind: "rotation", detail: `yaw ${(dHeading / dt).toFixed(2)} rad/s` });
    fix().heading = prev.heading + Math.sign(dHeading) * maxYaw;
  }

  // Teleport: distance travelled bounded by the faster of the two speeds.
  const travelled = Math.hypot(next.x - prev.x, next.y - prev.y);
  // Car-on-car separation can shift a car by up to one radius without changing its speed.
  const separation = ctx.impulse ? config.car.radius * 2 : 0;
  const maxTravel =
    Math.max(prevSpeed, Math.min(nextSpeed, ctx.impulse ? hardCap : legalCap)) * dt * (1 + ac.speedTolerance) + ac.teleportSlack + separation;
  if (travelled > maxTravel) {
    violations.push({ kind: "teleport", detail: `moved ${travelled.toFixed(2)}m > ${maxTravel.toFixed(2)}m` });
    const c = fix();
    c.x = prev.x;
    c.y = prev.y;
  }

  // Jumps: bounded height and take-off speed, and no extra lift once airborne (no double jump / fly hack).
  const pz = prev.z ?? 0;
  const pvz = prev.vz ?? 0;
  const nz = next.z ?? 0;
  const nvz = next.vz ?? 0;
  const ceilingZ = maxJumpHeight(config) * (1 + ac.speedTolerance) + 0.05;
  const takeoffSpeed = config.car.jumpVelocity * (1 + ac.speedTolerance);
  if (nz < -1e-6 || nz > ceilingZ || nvz > takeoffSpeed) {
    violations.push({ kind: "jump", detail: `z ${nz.toFixed(2)} vz ${nvz.toFixed(2)}` });
    const c = fix();
    c.z = Math.max(0, Math.min(nz, ceilingZ));
    c.vz = Math.min(nvz, 0);
  } else if (pz > 0 && nz > 0 && nvz > pvz + 1e-6) {
    violations.push({ kind: "jump", detail: `lift while airborne: vz ${pvz.toFixed(2)} → ${nvz.toFixed(2)}` });
    fix().vz = pvz - config.car.gravity * dt;
  }

  // Bounds: the walls are at ±halfWidth; the car centre can get within its radius.
  const px = out.x;
  const py = out.y;
  const proj = ctx.track.project(px, py, ctx.segmentHint ?? -1);
  const edge = ctx.track.halfWidth - config.car.radius;
  const beyond = Math.abs(proj.lateral) - edge;
  let respawn = false;
  if (beyond > ac.boundsSlack + 4) {
    violations.push({ kind: "out_of_bounds", detail: `lateral ${proj.lateral.toFixed(2)}m` });
    respawn = true;
  } else if (beyond > ac.boundsSlack) {
    violations.push({ kind: "wall_clip", detail: `lateral ${proj.lateral.toFixed(2)}m` });
    respawn = true;
  }

  return { violations, corrected: changed ? out : null, respawn };
}
