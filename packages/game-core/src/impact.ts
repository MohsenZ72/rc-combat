import type { GameConfig } from "@rc/shared";
import { clamp, TAU } from "./math.js";
import { absoluteSpeedCeiling } from "./vehicle.js";

/**
 * Collision response shared by the server simulation and client prediction.
 *
 * Arcade rigid-body impulses in the 2D plane: cars are capsules along their
 * heading, so a hit away from the centre line (a rear quarter, a nose clipping
 * a wall) produces torque and the car spins. Every hit also feeds a short
 * traction loss and a body roll/pitch kick; a very hard sideways hit rolls
 * the car over onto its wheels again (a "flip"). Deterministic and
 * allocation-free.
 */

/** Car state the impact model reads and writes. `MovementState` + position satisfies it. */
export interface ImpactBody {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  /** Steering yaw rate (rad/s). */
  yawRate: number;
  /** Extra yaw rate from impacts (rad/s); decays in `integrateMovement`. */
  spin: number;
  tractionTicks: number;
  flipTicks: number;
  /** Body roll (+ = roof towards the car's left) and pitch (+ = nose up), rad, and their rates. */
  roll: number;
  rollRate: number;
  pitch: number;
  pitchRate: number;
  speedCap: number;
  turboTicks: number;
}

export interface CarContact {
  /** Unit normal from car A towards car B. */
  nx: number;
  ny: number;
  /** Overlap depth in metres. */
  depth: number;
  /** Contact point in world space. */
  px: number;
  py: number;
}

export function carMass(car: Pick<ImpactBody, "turboTicks">, config: GameConfig): number {
  return config.impact.mass * (car.turboTicks > 0 ? config.impact.turboMassMultiplier : 1);
}

/** Closest points of two segments (Ericson, Real-Time Collision Detection 5.1.9). */
const seg = { s: 0, t: 0 };
function closestSegments(
  p1x: number, p1y: number, d1x: number, d1y: number,
  p2x: number, p2y: number, d2x: number, d2y: number,
): void {
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = 0;
    t = 0;
  } else if (a <= 1e-9) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-9) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  seg.s = s;
  seg.t = t;
}

const contactOut: CarContact = { nx: 0, ny: 0, depth: 0, px: 0, py: 0 };

/**
 * Capsule-capsule contact between two cars, or null if they don't touch.
 * The returned object is reused: copy what you need before the next call.
 */
export function carContact(a: Pick<ImpactBody, "x" | "y" | "heading">, b: Pick<ImpactBody, "x" | "y" | "heading">, config: GameConfig): CarContact | null {
  const L = config.impact.capsuleHalfLength;
  const r = config.impact.capsuleRadius;
  const reach = 2 * (L + r);
  const cdx = b.x - a.x;
  const cdy = b.y - a.y;
  if (cdx * cdx + cdy * cdy >= reach * reach) return null;
  const afx = Math.cos(a.heading) * L;
  const afy = Math.sin(a.heading) * L;
  const bfx = Math.cos(b.heading) * L;
  const bfy = Math.sin(b.heading) * L;
  closestSegments(a.x - afx, a.y - afy, 2 * afx, 2 * afy, b.x - bfx, b.y - bfy, 2 * bfx, 2 * bfy);
  const c1x = a.x - afx + 2 * afx * seg.s;
  const c1y = a.y - afy + 2 * afy * seg.s;
  const c2x = b.x - bfx + 2 * bfx * seg.t;
  const c2y = b.y - bfy + 2 * bfy * seg.t;
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.hypot(dx, dy);
  if (d >= 2 * r) return null;
  let nx: number;
  let ny: number;
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // Cores cross: fall back to the centre line, then to A's sideways axis.
    const cd = Math.hypot(cdx, cdy);
    nx = cd > 1e-6 ? cdx / cd : -Math.sin(a.heading);
    ny = cd > 1e-6 ? cdy / cd : Math.cos(a.heading);
  }
  const depth = 2 * r - d;
  contactOut.nx = nx;
  contactOut.ny = ny;
  contactOut.depth = depth;
  contactOut.px = c1x + nx * (r - depth / 2);
  contactOut.py = c1y + ny * (r - depth / 2);
  return contactOut;
}

/**
 * Applies the side effects of a velocity change from a hit: speed ceiling,
 * traction loss, roll/pitch kick and, on a very hard sideways hit, a flip.
 * `dvx, dvy` is the change of the car's centre velocity, `dSpin` its yaw change.
 */
export function applyKnock(car: ImpactBody, dvx: number, dvy: number, dSpin: number, config: GameConfig, dt: number, forceFlip = false): void {
  const im = config.impact;
  // Never faster than the absolute ceiling; carry the new speed as the decaying legal cap.
  const ceiling = absoluteSpeedCeiling(config);
  const speed = Math.hypot(car.vx, car.vy);
  if (speed > ceiling) {
    const k = ceiling / speed;
    car.vx *= k;
    car.vy *= k;
  }
  car.speedCap = Math.min(ceiling, Math.max(car.speedCap, Math.min(speed, ceiling)));

  const fx = Math.cos(car.heading);
  const fy = Math.sin(car.heading);
  const forward = dvx * fx + dvy * fy;
  const lateral = dvx * -fy + dvy * fx;

  // Traction: sideways shoves and spin unsettle the tyres; a straight push mostly doesn't.
  const upset = Math.hypot(lateral, forward * 0.35) + Math.abs(dSpin) * 0.5;
  if (upset >= im.tractionMinImpulse) {
    const t = clamp((upset - im.tractionMinImpulse) / Math.max(1e-6, im.tractionFullImpulse - im.tractionMinImpulse), 0, 1);
    const ticks = Math.round(((0.3 + 0.7 * t) * im.tractionLossSeconds) / dt);
    car.tractionTicks = Math.max(car.tractionTicks, ticks);
  }

  if (car.flipTicks > 0) return; // already rolling: the roll is scripted until it lands
  const grounded = car.z === 0 && car.vz === 0;
  if (grounded && (forceFlip || Math.abs(lateral) >= im.flipImpulse)) {
    const ticks = Math.max(1, Math.round(im.flipSeconds / dt));
    const dir = lateral >= 0 ? 1 : -1;
    car.flipTicks = ticks;
    // One full turn ending exactly upright, whatever the current lean.
    car.rollRate = (dir * TAU - car.roll) / (ticks * dt);
    car.vz = Math.min(im.flipHop, config.car.jumpVelocity);
    car.tractionTicks = Math.max(car.tractionTicks, ticks);
    return;
  }
  const maxRate = im.maxTiltRate;
  car.rollRate = clamp(car.rollRate + im.rollKick * lateral, -maxRate, maxRate);
  car.pitchRate = clamp(car.pitchRate + im.pitchKick * forward, -maxRate, maxRate);
}

/** Adds an impact yaw change to the car's spin, within the ceiling. */
function addSpin(car: ImpactBody, dSpin: number, config: GameConfig): number {
  const max = config.impact.maxSpin;
  const before = car.spin;
  car.spin = clamp(car.spin + dSpin, -max, max);
  return car.spin - before;
}

/**
 * Impulse between two touching cars (normal + Coulomb friction, with
 * rotation). Writes the result to `a`, and to `b` unless `applyToB` is false
 * (client prediction treats other cars as obstacles it cannot move).
 * Returns the normal impulse per unit mass (m/s), 0 if they were separating.
 */
export function resolveCarImpact(a: ImpactBody, b: ImpactBody, c: CarContact, config: GameConfig, dt: number, applyToB = true): number {
  const im = config.impact;
  const ma = carMass(a, config);
  const mb = carMass(b, config);
  const invMa = 1 / ma;
  const invMb = 1 / mb;
  const invIa = 1 / (ma * im.yawInertia);
  const invIb = 1 / (mb * im.yawInertia);
  const rax = c.px - a.x;
  const ray = c.py - a.y;
  const rbx = c.px - b.x;
  const rby = c.py - b.y;
  const wa = a.yawRate + a.spin;
  const wb = b.yawRate + b.spin;
  // Velocity of the contact point on each body: v + ω × r.
  const relx = b.vx - wb * rby - (a.vx - wa * ray);
  const rely = b.vy + wb * rbx - (a.vy + wa * rax);
  const vn = relx * c.nx + rely * c.ny;
  if (vn >= 0) return 0;
  const raN = rax * c.ny - ray * c.nx;
  const rbN = rbx * c.ny - rby * c.nx;
  const kn = invMa + invMb + raN * raN * invIa + rbN * rbN * invIb;
  const e = -vn > im.bounceMinSpeed ? config.car.carRestitution : 0;
  const jn = (-(1 + e) * vn) / kn;

  // Friction along the sliding direction, capped by Coulomb's law.
  let tx = relx - vn * c.nx;
  let ty = rely - vn * c.ny;
  const vt = Math.hypot(tx, ty);
  let jt = 0;
  if (vt > 1e-6) {
    tx /= vt;
    ty /= vt;
    const raT = rax * ty - ray * tx;
    const rbT = rbx * ty - rby * tx;
    const kt = invMa + invMb + raT * raT * invIa + rbT * rbT * invIb;
    jt = Math.min(vt / kt, im.carFriction * jn);
  }
  // Impulse on B (A gets the opposite).
  const px = jn * c.nx - jt * tx;
  const py = jn * c.ny - jt * ty;

  const dvax = -px * invMa;
  const dvay = -py * invMa;
  a.vx += dvax;
  a.vy += dvay;
  const dwa = addSpin(a, (rax * -py - ray * -px) * invIa, config);
  applyKnock(a, dvax, dvay, dwa, config, dt);
  if (applyToB) {
    const dvbx = px * invMb;
    const dvby = py * invMb;
    b.vx += dvbx;
    b.vy += dvby;
    const dwb = addSpin(b, (rbx * py - rby * px) * invIb, config);
    applyKnock(b, dvbx, dvby, dwb, config, dt);
  }
  // Average speed change of the two cars (equals the per-car change for equal masses).
  return (jn * (invMa + invMb)) / 2;
}

/**
 * Velocity response after the physics world stopped the car against a wall
 * with outward normal (nx, ny). The contact is at the end of the car that
 * points into the wall, so a glancing nose hit turns the car away from the
 * wall. Bounces above `bounceMinSpeed`, scrapes below it.
 * Returns the normal speed change (m/s), 0 if the car was moving away.
 */
export function applyWallImpact(car: ImpactBody, nx: number, ny: number, config: GameConfig, dt: number): number {
  const im = config.impact;
  const L = im.capsuleHalfLength;
  const fx = Math.cos(car.heading);
  const fy = Math.sin(car.heading);
  // The capsule end deeper into the wall (more against the normal) takes the hit.
  const end = fx * nx + fy * ny <= 0 ? 1 : -1;
  const rx = end * fx * L - nx * im.capsuleRadius;
  const ry = end * fy * L - ny * im.capsuleRadius;
  const w = car.yawRate + car.spin;
  const vpx = car.vx - w * ry;
  const vpy = car.vy + w * rx;
  const vn = vpx * nx + vpy * ny;
  if (vn >= 0) return 0;
  // A real hit bounces and turns the car about the contact point; a slow scrape only stops
  // the into-wall motion (no torque, or grinding along a wall would keep winding up spin).
  const impact = -vn > im.bounceMinSpeed;
  const invI = 1 / im.yawInertia;
  const rN = rx * ny - ry * nx;
  const e = impact ? config.car.wallRestitution : 0;
  const jn = impact ? (-(1 + e) * vn) / (1 + rN * rN * invI) : -(car.vx * nx + car.vy * ny);
  if (jn <= 0) return 0;
  // Coulomb friction through the centre: it scrubs speed along the wall in proportion to the hit.
  let tx = car.vx - (car.vx * nx + car.vy * ny) * nx;
  let ty = car.vy - (car.vx * nx + car.vy * ny) * ny;
  const vt = Math.hypot(tx, ty);
  let jt = 0;
  if (vt > 1e-6) {
    tx /= vt;
    ty /= vt;
    jt = Math.min(vt, im.wallFriction * jn);
  }
  const px = jn * nx - jt * tx;
  const py = jn * ny - jt * ty;
  car.vx += px;
  car.vy += py;
  const dw = impact ? addSpin(car, rN * jn * invI, config) : 0;
  applyKnock(car, px, py, dw, config, dt);
  return jn;
}
