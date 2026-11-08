import type { AnomalyKind, SuspicionLevel } from "./config.js";
import type { ItemKind } from "./protocol.js";

/**
 * Discrete gameplay events. They feed the client HUD/effects, the replay log
 * and the telemetry pipeline. All are produced by the server simulation.
 */
export type GameEvent =
  | { type: "countdown"; tick: number; secondsLeft: number }
  | { type: "race_start"; tick: number }
  | { type: "pickup"; tick: number; slot: number; item: ItemKind; box: number }
  | { type: "item_used"; tick: number; slot: number; item: ItemKind; target?: number }
  | { type: "item_rejected"; tick: number; slot: number; item: ItemKind; reason: ItemRejectReason }
  | { type: "fire"; tick: number; slot: number; ammoLeft: number }
  | { type: "hit"; tick: number; source: ProjectileSource; attacker: number; victim: number; damage: number; blocked: boolean }
  | { type: "wreck"; tick: number; slot: number; by: number | null }
  | { type: "respawn"; tick: number; slot: number }
  | { type: "checkpoint"; tick: number; slot: number; gate: number; lap: number }
  | { type: "lap"; tick: number; slot: number; lap: number; lapTicks: number }
  | { type: "finish"; tick: number; slot: number; rank: number; raceTicks: number }
  | { type: "collision"; tick: number; slot: number; other: number | "wall"; impulse: number }
  | { type: "forfeit"; tick: number; slot: number; reason: "left" | "timeout" | "kicked" }
  | { type: "anomaly"; tick: number; slot: number; kind: AnomalyKind; points: number; level: SuspicionLevel; detail: string }
  | { type: "race_end"; tick: number; reason: "all_finished" | "time_limit" | "grace_expired" | "abandoned" };

export type ProjectileSource = "bolt" | "rocket" | "mine" | "emp";

export type ItemRejectReason =
  | "no_item"
  | "cooldown"
  | "item_locked"
  | "no_target"
  | "not_racing"
  | "disabled"
  | "mine_limit";

/** Events only the affected player should receive (anti-cheat detail stays server-side). */
export const PRIVATE_EVENT_TYPES = new Set<GameEvent["type"]>(["anomaly", "item_rejected"]);
