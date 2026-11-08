/**
 * Central gameplay + anti-cheat configuration.
 *
 * Every number the server uses to simulate or validate a match lives here so
 * that balance and anti-cheat tolerances can be tuned in one place. The client
 * reads the same object for prediction, so it must never contain secrets.
 */

export interface CarConfig {
  /** Collision radius in metres. */
  radius: number;
  /** Top forward speed in m/s without effects. */
  maxSpeed: number;
  maxReverseSpeed: number;
  /** Forward acceleration in m/s². */
  acceleration: number;
  /** Deceleration while braking forward, m/s². */
  brakeDeceleration: number;
  reverseAcceleration: number;
  /** Passive deceleration with no throttle, m/s². */
  coastDeceleration: number;
  /** Maximum yaw rate in rad/s at the ideal steering speed. */
  maxYawRate: number;
  /** Speed (m/s) below which steering is scaled down linearly. */
  fullSteerSpeed: number;
  /** Share of steering lost at top speed (0..1). */
  highSpeedSteerLoss: number;
  /** Lateral grip (1/s). Higher = less sliding. */
  grip: number;
  driftGrip: number;
  driftYawMultiplier: number;
  /** Speed multiplier while drifting (drift is a trade, not a free boost). */
  driftSpeedMultiplier: number;
  /** Fraction of velocity kept along a wall after a scrape. */
  wallFriction: number;
  /** Bounce coefficient against walls. */
  wallRestitution: number;
  /** Bounce coefficient between cars. */
  carRestitution: number;
  maxHealth: number;
}

export interface ItemConfig {
  rocket: { speed: number; turnRate: number; lifetime: number; damage: number; stun: number; hitRadius: number; armTime: number };
  mine: { lifetime: number; armTime: number; damage: number; stun: number; triggerRadius: number; maxActivePerPlayer: number; dropOffset: number };
  shield: { duration: number };
  turbo: { duration: number; speedMultiplier: number; accelerationMultiplier: number };
  emp: { range: number; controlDuration: number; itemLockDuration: number; throttleCap: number; steerScale: number };
  repair: { amount: number };
  bolt: { speed: number; lifetime: number; damage: number; cooldown: number; maxAmmo: number; hitRadius: number; slowFactor: number };
  /** Minimum seconds between two item activations, on top of single-use items. */
  globalItemCooldown: number;
  boxRespawn: number;
  boxRadius: number;
}

export interface RaceConfig {
  laps: number;
  countdownSeconds: number;
  /** Hard cap for the race phase; unfinished cars are ranked by progress. */
  maxRaceSeconds: number;
  /** Once the first car finishes the others get this long. */
  finishGraceSeconds: number;
  wreckSeconds: number;
  respawnProtectionSeconds: number;
  wrongWaySeconds: number;
}

export interface NetConfig {
  tickRate: number;
  /** Send a snapshot every N ticks. */
  snapshotDivisor: number;
  /** Max queued inputs per player before the oldest are dropped. */
  inputBufferSize: number;
  /** Token bucket: inputs/second sustained, as a multiple of tickRate. */
  inputRateMultiplier: number;
  inputBurst: number;
  /** Max accepted WebSocket payload in bytes. */
  maxMessageBytes: number;
  pingIntervalMs: number;
  /** Client-side interpolation delay for remote entities. */
  interpolationDelayMs: number;
}

export type AnomalyKind =
  | "malformed_packet"
  | "input_flood"
  | "replayed_input"
  | "forbidden_message"
  | "speed"
  | "acceleration"
  | "rotation"
  | "teleport"
  | "out_of_bounds"
  | "wall_clip"
  | "checkpoint_skip"
  | "progress_jump"
  | "invalid_state";

export type SuspicionLevel =
  | "normal"
  | "suspicious"
  | "flagged"
  | "restricted"
  | "match_invalidated"
  | "temporary_suspension"
  | "manual_review";

export interface AntiCheatConfig {
  /** Relative tolerance on speed/distance limits (0.1 = +10%). */
  speedTolerance: number;
  rotationTolerance: number;
  accelerationTolerance: number;
  /** Absolute slack in metres per tick for teleport checks. */
  teleportSlack: number;
  /** Lateral metres beyond the track edge before a car counts as out of bounds. */
  boundsSlack: number;
  /** Max legitimate forward progress per tick, as a multiple of max distance per tick. */
  progressJumpFactor: number;
  points: Record<AnomalyKind, number>;
  /** Same kind within this window multiplies points (repeated impossible movement). */
  repeatWindowSeconds: number;
  repeatMultiplier: number;
  /** Points removed per second for low-severity noise (latency, jitter). */
  decayPerSecond: number;
  /** Score thresholds (inclusive) per level, ascending. */
  thresholds: { suspicious: number; flagged: number; restricted: number; matchInvalidated: number; temporarySuspension: number };
  /** Malformed/forbidden messages inside this window before the client is kicked. */
  kickAfterProtocolViolations: number;
  protocolViolationWindowSeconds: number;
}

export interface GameConfig {
  car: CarConfig;
  items: ItemConfig;
  race: RaceConfig;
  net: NetConfig;
  antiCheat: AntiCheatConfig;
  maxPlayers: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  maxPlayers: 10,
  car: {
    radius: 1.1,
    maxSpeed: 30,
    maxReverseSpeed: 9,
    acceleration: 15,
    brakeDeceleration: 34,
    reverseAcceleration: 10,
    coastDeceleration: 5,
    maxYawRate: 2.6,
    fullSteerSpeed: 7,
    highSpeedSteerLoss: 0.35,
    grip: 9,
    driftGrip: 2.6,
    driftYawMultiplier: 1.45,
    driftSpeedMultiplier: 0.94,
    wallFriction: 0.82,
    wallRestitution: 0.25,
    carRestitution: 0.6,
    maxHealth: 100,
  },
  items: {
    rocket: { speed: 46, turnRate: 3.2, lifetime: 4, damage: 35, stun: 1.0, hitRadius: 0.9, armTime: 0.15 },
    mine: { lifetime: 30, armTime: 0.5, damage: 25, stun: 0.7, triggerRadius: 1.3, maxActivePerPlayer: 3, dropOffset: 2.6 },
    shield: { duration: 4 },
    turbo: { duration: 2.5, speedMultiplier: 1.3, accelerationMultiplier: 1.8 },
    emp: { range: 160, controlDuration: 1.6, itemLockDuration: 3, throttleCap: 0.6, steerScale: 0.5 },
    repair: { amount: 35 },
    bolt: { speed: 75, lifetime: 0.8, damage: 8, cooldown: 0.5, maxAmmo: 10, hitRadius: 0.5, slowFactor: 0.9 },
    globalItemCooldown: 1,
    boxRespawn: 6,
    boxRadius: 2.2,
  },
  race: {
    laps: 5,
    countdownSeconds: 4,
    maxRaceSeconds: 300,
    finishGraceSeconds: 30,
    wreckSeconds: 2,
    respawnProtectionSeconds: 1.5,
    wrongWaySeconds: 1,
  },
  net: {
    tickRate: 30,
    snapshotDivisor: 2,
    inputBufferSize: 6,
    inputRateMultiplier: 1.5,
    inputBurst: 30,
    maxMessageBytes: 4096,
    pingIntervalMs: 2000,
    interpolationDelayMs: 120,
  },
  antiCheat: {
    speedTolerance: 0.08,
    rotationTolerance: 0.15,
    accelerationTolerance: 0.25,
    teleportSlack: 0.05,
    boundsSlack: 1.5,
    progressJumpFactor: 1.6,
    points: {
      malformed_packet: 1,
      input_flood: 1,
      replayed_input: 1,
      forbidden_message: 5,
      speed: 5,
      acceleration: 5,
      rotation: 5,
      teleport: 20,
      out_of_bounds: 20,
      wall_clip: 20,
      checkpoint_skip: 20,
      progress_jump: 20,
      invalid_state: 20,
    },
    repeatWindowSeconds: 10,
    repeatMultiplier: 2.5,
    decayPerSecond: 0.05,
    thresholds: { suspicious: 5, flagged: 20, restricted: 50, matchInvalidated: 80, temporarySuspension: 150 },
    kickAfterProtocolViolations: 25,
    protocolViolationWindowSeconds: 10,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a new config with `overrides` deep-merged onto `base`. */
export function mergeConfig(base: GameConfig, overrides: DeepPartial<GameConfig>): GameConfig {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) {
      if (value === undefined) continue;
      const current = out[key];
      out[key] = isPlainObject(current) && isPlainObject(value) ? merge(current, value) : value;
    }
    return out;
  };
  return merge(base as unknown as Record<string, unknown>, overrides as Record<string, unknown>) as unknown as GameConfig;
}

export type { DeepPartial };

/** Seconds → whole ticks, never below one. */
export function secondsToTicks(seconds: number, tickRate: number): number {
  return Math.max(1, Math.round(seconds * tickRate));
}

/**
 * Stable short hash of the config so replays and results can prove which
 * rules they ran under (FNV-1a over canonical JSON).
 */
export function configHash(config: GameConfig): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (isPlainObject(value)) {
      return `{${Object.keys(value)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  let hash = 0x811c9dc5;
  const text = canonical(config);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
