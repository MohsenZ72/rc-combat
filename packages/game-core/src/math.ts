export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Squared distance from point p to segment ab. */
export function pointSegmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / lenSq : 0;
  t = clamp(t, 0, 1);
  const dx = ax + abx * t - px;
  const dy = ay + aby * t - py;
  return dx * dx + dy * dy;
}

/**
 * Closest distance between moving point segment p0→p1 and a static point c,
 * squared. Used for projectile sweeps so fast shots cannot tunnel.
 */
export function sweepPointDistSq(p0x: number, p0y: number, p1x: number, p1y: number, cx: number, cy: number): number {
  return pointSegmentDistSq(cx, cy, p0x, p0y, p1x, p1y);
}

/** Returns t on segment p (0..1) where p0→p1 crosses q0→q1, or -1. */
export function segmentIntersectT(
  p0x: number, p0y: number, p1x: number, p1y: number,
  q0x: number, q0y: number, q1x: number, q1y: number,
): number {
  const rX = p1x - p0x;
  const rY = p1y - p0y;
  const sX = q1x - q0x;
  const sY = q1y - q0y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-12) return -1;
  const qpX = q0x - p0x;
  const qpY = q0y - p0y;
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

export function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}
