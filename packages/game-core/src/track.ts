import { mergeConfig, type GameConfig } from "@rc/shared";
import { clamp, type Vec2 } from "./math.js";

/** Match config for a track: applies its lap count over the defaults. */
export function configForTrack(config: GameConfig, def: TrackDefinition): GameConfig {
  return def.laps ? mergeConfig(config, { race: { laps: def.laps } }) : config;
}

/** Visual setting; the client picks floor, surface, barriers and props from it. */
export type TrackTheme = "toy-track" | "rug" | "kitchen" | "toy-canyon" | "bathroom" | "garden" | "bedroom" | "workshop" | "library" | "sandbox";

export interface TrackDefinition {
  id: string;
  name: string;
  theme: TrackTheme;
  /** Closed loop of control points in metres [x, y, height?], driven in the listed order. */
  controlPoints: ReadonlyArray<readonly [number, number] | readonly [number, number, number]>;
  /** Shallow water stretches as lap fractions (slower, slippery). */
  water?: ReadonlyArray<{ from: number; to: number }>;
  /** Ramp lips as lap fractions: crossing one fast enough launches the car. */
  ramps?: ReadonlyArray<{ at: number }>;
  /** Laps for this track (longer/hillier tracks run fewer to keep ~4 min races). */
  laps?: number;
  width: number;
  checkpointCount: number;
  /** Rows of item boxes, `at` is the fraction of a lap (0..1). */
  itemRows: ReadonlyArray<{ at: number; count: number }>;
  /** Sampling distance of the centreline in metres. */
  sampleSpacing: number;
}

export interface TrackProjection {
  /** Arc length along the centreline, 0..length. */
  s: number;
  /** Signed lateral offset: + is left of travel direction. */
  lateral: number;
  segment: number;
  tangentX: number;
  tangentY: number;
}

export interface Gate {
  index: number;
  s: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Direction of travel through the gate. */
  tx: number;
  ty: number;
}

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

/**
 * Immutable, precomputed track geometry. Built once per match from a
 * definition; shared by server simulation, client prediction and rendering.
 */
export class Track {
  readonly def: TrackDefinition;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  readonly cumulative: Float64Array;
  readonly length: number;
  readonly halfWidth: number;
  readonly gates: Gate[];
  readonly boxes: Vec2[];
  readonly count: number;
  /** Ground height per centreline sample (metres). */
  readonly zs: Float64Array;
  /** dz/ds per sample. */
  readonly slopes: Float64Array;
  readonly rampS: number[];
  readonly waterRanges: { from: number; to: number }[];

  constructor(def: TrackDefinition) {
    this.def = def;
    this.halfWidth = def.width / 2;
    const dense = sampleClosedCatmullRom(def.controlPoints, 24);
    const resampled = resampleByArcLength(dense, def.sampleSpacing);
    this.count = resampled.length;
    const n = this.count;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.slopes = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.cumulative = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.xs[i] = resampled[i]!.x;
      this.ys[i] = resampled[i]!.y;
      this.zs[i] = Math.max(0, resampled[i]!.z);
    }
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.cumulative[i] = acc;
      const j = (i + 1) % n;
      acc += Math.hypot(this.xs[j]! - this.xs[i]!, this.ys[j]! - this.ys[i]!);
    }
    this.cumulative[n] = acc;
    this.length = acc;
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n;
      const q = (i + 1) % n;
      const dx = this.xs[q]! - this.xs[p]!;
      const dy = this.ys[q]! - this.ys[p]!;
      const len = Math.hypot(dx, dy) || 1;
      this.tx[i] = dx / len;
      this.ty[i] = dy / len;
      this.slopes[i] = (this.zs[q]! - this.zs[p]!) / len;
    }
    this.rampS = (def.ramps ?? []).map((r) => r.at * this.length);
    this.waterRanges = (def.water ?? []).map((w) => ({ from: w.from * this.length, to: w.to * this.length }));

    this.gates = [];
    for (let k = 0; k < def.checkpointCount; k++) {
      const s = (k * this.length) / def.checkpointCount;
      const pose = this.poseAt(s);
      const fx = Math.cos(pose.heading);
      const fy = Math.sin(pose.heading);
      const reach = this.halfWidth + 2;
      this.gates.push({
        index: k,
        s,
        ax: pose.x - fy * reach,
        ay: pose.y + fx * reach,
        bx: pose.x + fy * reach,
        by: pose.y - fx * reach,
        tx: fx,
        ty: fy,
      });
    }

    this.boxes = [];
    for (const row of def.itemRows) {
      const pose = this.poseAt(row.at * this.length);
      const lx = -Math.sin(pose.heading);
      const ly = Math.cos(pose.heading);
      const usable = this.def.width - 4;
      for (let i = 0; i < row.count; i++) {
        const offset = row.count === 1 ? 0 : -usable / 2 + (usable * i) / (row.count - 1);
        this.boxes.push({ x: pose.x + lx * offset, y: pose.y + ly * offset });
      }
    }
  }

  private sampleIndex(s: number): { i: number; j: number; f: number } {
    const L = this.length;
    let t = s % L;
    if (t < 0) t += L;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    const segLen = this.cumulative[lo + 1]! - this.cumulative[lo]!;
    return { i: lo, j: (lo + 1) % this.count, f: segLen > 0 ? (t - this.cumulative[lo]!) / segLen : 0 };
  }

  /** Ground height under arc length `s`. The track is flat across its width. */
  heightAt(s: number): number {
    const { i, j, f } = this.sampleIndex(s);
    return this.zs[i]! + (this.zs[j]! - this.zs[i]!) * f;
  }

  /** dz/ds along the direction of travel at `s`. */
  slopeAt(s: number): number {
    const { i, j, f } = this.sampleIndex(s);
    return this.slopes[i]! + (this.slopes[j]! - this.slopes[i]!) * f;
  }

  waterAt(s: number): boolean {
    for (const w of this.waterRanges) if (s >= w.from && s <= w.to) return true;
    return false;
  }

  /** True if moving from prevS to s (forwards, not across the lap seam backwards) passes a ramp lip. */
  rampCrossed(prevS: number, s: number): boolean {
    if (this.rampS.length === 0) return false;
    let d = s - prevS;
    if (d < -this.length / 2) d += this.length;
    if (d <= 0 || d > 10) return false;
    for (const r of this.rampS) {
      let a = r - prevS;
      if (a < 0) a += this.length;
      if (a > 0 && a <= d) return true;
    }
    return false;
  }

  /** Ground under a car: slope along its heading and whether it is in water. */
  surfaceUnder(x: number, y: number, heading: number, hint: number): { slope: number; water: boolean; s: number; segment: number } {
    const p = this.project(x, y, hint);
    const along = Math.cos(heading) * p.tangentX + Math.sin(heading) * p.tangentY;
    return { slope: this.slopeAt(p.s) * along, water: this.waterAt(p.s), s: p.s, segment: p.segment };
  }

  /** Highest and lowest ground and steepest grade (for validation and tooling). */
  elevationStats(): { min: number; max: number; maxSlope: number } {
    let min = Infinity;
    let max = -Infinity;
    let maxSlope = 0;
    for (let i = 0; i < this.count; i++) {
      min = Math.min(min, this.zs[i]!);
      max = Math.max(max, this.zs[i]!);
      maxSlope = Math.max(maxSlope, Math.abs(this.slopes[i]!));
    }
    return { min, max, maxSlope };
  }

  /** Position and travel heading on the centreline at arc length `s` (wraps). */
  poseAt(s: number): Pose {
    const L = this.length;
    let t = s % L;
    if (t < 0) t += L;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const j = (i + 1) % this.count;
    const segLen = this.cumulative[i + 1]! - this.cumulative[i]!;
    const f = segLen > 0 ? (t - this.cumulative[i]!) / segLen : 0;
    const x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * f;
    const y = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * f;
    const heading = Math.atan2(this.ys[j]! - this.ys[i]!, this.xs[j]! - this.xs[i]!);
    return { x, y, heading };
  }

  /**
   * Nearest point on the centreline. `hint` (a previous segment) makes it
   * O(window) instead of O(n); falls back to a global search when far off.
   */
  project(x: number, y: number, hint = -1): TrackProjection {
    const n = this.count;
    let best = -1;
    let bestD = Infinity;
    let bestT = 0;
    const consider = (i: number) => {
      const j = (i + 1) % n;
      const ax = this.xs[i]!;
      const ay = this.ys[i]!;
      const abx = this.xs[j]! - ax;
      const aby = this.ys[j]! - ay;
      const lenSq = abx * abx + aby * aby;
      const t = lenSq > 0 ? clamp(((x - ax) * abx + (y - ay) * aby) / lenSq, 0, 1) : 0;
      const dx = ax + abx * t - x;
      const dy = ay + aby * t - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
        bestT = t;
      }
    };
    if (hint >= 0) {
      for (let k = -12; k <= 12; k++) consider((hint + k + n) % n);
      if (bestD > this.halfWidth * this.halfWidth * 4) {
        for (let i = 0; i < n; i++) consider(i);
      }
    } else {
      for (let i = 0; i < n; i++) consider(i);
    }
    const i = best;
    const j = (i + 1) % n;
    const segLen = this.cumulative[i + 1]! - this.cumulative[i]!;
    const sx = this.xs[j]! - this.xs[i]!;
    const sy = this.ys[j]! - this.ys[i]!;
    const len = Math.hypot(sx, sy) || 1;
    const tX = sx / len;
    const tY = sy / len;
    const px = this.xs[i]! + sx * bestT;
    const py = this.ys[i]! + sy * bestT;
    const lateral = (x - px) * -tY + (y - py) * tX;
    return { s: this.cumulative[i]! + segLen * bestT, lateral, segment: i, tangentX: tX, tangentY: tY };
  }

  /** Boundary polyline (closed, first point repeated last). side: +1 left, -1 right. */
  boundary(side: 1 | -1, inset = 0): Vec2[] {
    const out: Vec2[] = [];
    const off = (this.halfWidth - inset) * side;
    for (let i = 0; i < this.count; i++) {
      out.push({ x: this.xs[i]! - this.ty[i]! * off, y: this.ys[i]! + this.tx[i]! * off });
    }
    out.push({ ...out[0]! });
    return out;
  }

  /** Boundary with ground height per sample (for rendering). Closed: first point repeated last. */
  boundary3(side: 1 | -1, inset = 0): { x: number; y: number; z: number; s: number }[] {
    const flat = this.boundary(side, inset);
    return flat.map((p, i) => {
      const k = i % this.count;
      return { x: p.x, y: p.y, z: this.zs[k]!, s: i === this.count ? this.length : this.cumulative[k]! };
    });
  }

  /** Starting grid: two columns behind the start/finish line. */
  gridPose(slot: number): Pose {
    const row = Math.floor(slot / 2);
    const col = slot % 2 === 0 ? 1 : -1;
    const s = this.length - 6 - row * 6 - (slot % 2) * 3;
    const pose = this.poseAt(s);
    const lx = -Math.sin(pose.heading);
    const ly = Math.cos(pose.heading);
    const lateral = col * this.halfWidth * 0.4;
    return { x: pose.x + lx * lateral, y: pose.y + ly * lateral, heading: pose.heading };
  }

  /** Smallest radius of curvature along the centreline (sanity check for walls). */
  minCurvatureRadius(): number {
    let minR = Infinity;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n;
      const c = (i + 2) % n;
      const ax = this.xs[a]!, ay = this.ys[a]!;
      const bx = this.xs[i]!, by = this.ys[i]!;
      const cx = this.xs[c]!, cy = this.ys[c]!;
      const ab = Math.hypot(bx - ax, by - ay);
      const bc = Math.hypot(cx - bx, cy - by);
      const ca = Math.hypot(ax - cx, ay - cy);
      const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      if (cross < 1e-9) continue;
      minR = Math.min(minR, (ab * bc * ca) / (2 * cross));
    }
    return minR;
  }
}

type Vec3 = Vec2 & { z: number };
type ControlPoint = readonly [number, number] | readonly [number, number, number];

/** Centripetal Catmull-Rom through a closed loop of points (height interpolated on the same parameter). */
function sampleClosedCatmullRom(points: ReadonlyArray<ControlPoint>, perSegment: number): Vec3[] {
  const n = points.length;
  const out: Vec3[] = [];
  const P = (i: number): readonly [number, number, number] => {
    const p = points[((i % n) + n) % n]!;
    return [p[0], p[1], p[2] ?? 0];
  };
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
    const t2 = t1 + Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
    const t3 = t2 + Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]));
    for (let k = 0; k < perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment;
      const A1 = mix(p0, p1, t0, t1, t);
      const A2 = mix(p1, p2, t1, t2, t);
      const A3 = mix(p2, p3, t2, t3, t);
      const B1 = mixV(A1, A2, t0, t2, t);
      const B2 = mixV(A2, A3, t1, t3, t);
      out.push(mixV(B1, B2, t1, t2, t));
    }
  }
  return out;
}

function mix(a: readonly [number, number, number], b: readonly [number, number, number], ta: number, tb: number, t: number): Vec3 {
  const w = tb - ta === 0 ? 0 : (t - ta) / (tb - ta);
  return { x: a[0] + (b[0] - a[0]) * w, y: a[1] + (b[1] - a[1]) * w, z: a[2] + (b[2] - a[2]) * w };
}

function mixV(a: Vec3, b: Vec3, ta: number, tb: number, t: number): Vec3 {
  const w = tb - ta === 0 ? 0 : (t - ta) / (tb - ta);
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w };
}

function resampleByArcLength(points: Vec3[], spacing: number): Vec3[] {
  const n = points.length;
  let total = 0;
  const seg: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d);
    total += d;
  }
  const count = Math.max(8, Math.round(total / spacing));
  const step = total / count;
  const out: Vec3[] = [];
  let i = 0;
  let consumed = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (consumed + seg[i]! < target && i < n - 1) {
      consumed += seg[i]!;
      i++;
    }
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const f = seg[i]! > 0 ? (target - consumed) / seg[i]! : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
  }
  return out;
}
