import type { AnomalyKind, AntiCheatConfig, SuspicionLevel } from "@rc/shared";
import type { AnomalyRecord } from "@rc/shared";

const MINOR_THRESHOLD = 5;
const MAX_RECORDS = 400;

export const LEVEL_ORDER: SuspicionLevel[] = [
  "normal",
  "suspicious",
  "flagged",
  "restricted",
  "match_invalidated",
  "temporary_suspension",
];

export function levelForScore(score: number, t: AntiCheatConfig["thresholds"]): SuspicionLevel {
  if (score >= t.temporarySuspension) return "temporary_suspension";
  if (score >= t.matchInvalidated) return "match_invalidated";
  if (score >= t.restricted) return "restricted";
  if (score >= t.flagged) return "flagged";
  if (score >= t.suspicious) return "suspicious";
  return "normal";
}

export function levelAtLeast(level: SuspicionLevel, min: SuspicionLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(min);
}

export interface SuspicionReport {
  points: number;
  score: number;
  level: SuspicionLevel;
  levelChanged: boolean;
}

/**
 * Accumulates anomaly points for one player in one match.
 *
 * Minor anomalies (network noise: floods, duplicate packets) decay over time
 * so a bad connection never escalates on its own. Major anomalies (impossible
 * movement) never decay, and repeats of the same kind inside the repeat
 * window are multiplied, so sustained cheating escalates fast while a single
 * glitch does not.
 */
export class SuspicionTracker {
  private minor = 0;
  private major = 0;
  private readonly lastTickByKind = new Map<AnomalyKind, number>();
  private currentLevel: SuspicionLevel = "normal";
  readonly records: AnomalyRecord[] = [];
  readonly counts = new Map<AnomalyKind, number>();

  constructor(private readonly config: AntiCheatConfig, private readonly tickRate: number) {}

  get score(): number {
    return this.minor + this.major;
  }

  get level(): SuspicionLevel {
    return this.currentLevel;
  }

  /** Players at or above "flagged" go into the manual review queue. */
  get needsManualReview(): boolean {
    return levelAtLeast(this.currentLevel, "flagged");
  }

  report(kind: AnomalyKind, tick: number, detail: string): SuspicionReport {
    const base = this.config.points[kind];
    const last = this.lastTickByKind.get(kind);
    const repeated = last !== undefined && tick - last <= this.config.repeatWindowSeconds * this.tickRate;
    const points = repeated && base >= MINOR_THRESHOLD ? base * this.config.repeatMultiplier : base;
    this.lastTickByKind.set(kind, tick);
    if (base < MINOR_THRESHOLD) this.minor += points;
    else this.major += points;
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    if (this.records.length < MAX_RECORDS) this.records.push({ tick, kind, points, detail: detail.slice(0, 200) });
    return this.updateLevel(points);
  }

  /** Call once per tick. */
  decay(dtSeconds: number): void {
    if (this.minor > 0) {
      this.minor = Math.max(0, this.minor - this.config.decayPerSecond * dtSeconds);
      this.updateLevel(0);
    }
  }

  private updateLevel(points: number): SuspicionReport {
    const next = levelForScore(this.score, this.config.thresholds);
    // Levels only escalate within a match; decay lowers the score, not a verdict already reached.
    const levelChanged = LEVEL_ORDER.indexOf(next) > LEVEL_ORDER.indexOf(this.currentLevel);
    if (levelChanged) this.currentLevel = next;
    return { points, score: this.score, level: this.currentLevel, levelChanged };
  }
}
