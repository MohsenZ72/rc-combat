import { z } from "zod";
import type { AnomalyKind, SuspicionLevel } from "./config.js";

import type { Cosmetics } from "./cosmetics.js";

/** Lobby-level description of a seat in the match. */
export interface PlayerSeat {
  slot: number;
  playerId: string | null;
  nickname: string;
  isBot: boolean;
  color: string;
  /** Visual-only loadout, validated server-side. */
  cosmetics?: Cosmetics;
}

export type PlayerFinishStatus = "finished" | "dnf" | "forfeit";
export type MatchStatus = "running" | "finished" | "abandoned" | "invalidated";

export interface PlayerTelemetry {
  ticks: number;
  avgSpeed: number;
  maxSpeed: number;
  maxAcceleration: number;
  maxYawRate: number;
  distance: number;
  inputsReceived: number;
  inputsDropped: number;
  inputsRejected: number;
  packetIntervalMeanMs: number;
  packetIntervalJitterMs: number;
  pingMs: number;
  pingMaxMs: number;
  itemsPicked: number;
  itemsUsed: number;
  shotsFired: number;
  damageDealt: number;
  damageTaken: number;
  wallCollisions: number;
  carCollisions: number;
  wrecks: number;
  disconnects: number;
  reconnects: number;
}

export interface AnomalyRecord {
  tick: number;
  kind: AnomalyKind;
  points: number;
  detail: string;
}

export interface PlayerResult {
  slot: number;
  playerId: string | null;
  nickname: string;
  isBot: boolean;
  rank: number;
  status: PlayerFinishStatus;
  /** Race time in ms (server ticks × tick length) when finished. */
  finishTimeMs: number | null;
  lapsCompleted: number;
  progress: number;
  suspicionScore: number;
  suspicionLevel: SuspicionLevel;
  /** False when anti-cheat says this result must not be trusted. */
  verified: boolean;
  telemetry: PlayerTelemetry;
  anomalies: AnomalyRecord[];
}

/** Final, server-produced match outcome. The single source of truth for payouts. */
export interface MatchOutcome {
  matchId: string;
  serverId: string;
  trackId: string;
  seed: number;
  configHash: string;
  tickRate: number;
  status: MatchStatus;
  startedAt: string;
  endedAt: string;
  endReason: string;
  /** False if the match as a whole is untrustworthy (abandoned, bots in ranked, …). */
  verified: boolean;
  results: PlayerResult[];
}

// ------------------------------------------------------------ future: tournaments

/**
 * Prepared for paid tournaments (see docs/system-design/web3.md). In the MVP
 * every match is free, `entryFee` is 0 and no settlement moves money.
 */
export interface Tournament {
  id: string;
  entryFee: number;
  currency: string;
  prizePool: number;
  /** Basis points of each payout tier, rank 1 first. Must sum to ≤ 10000 - rakeBps. */
  payoutBps: number[];
  rakeBps: number;
}

/** Shape the prize system consumes. Only verified results may ever be paid. */
export interface MatchResult {
  matchId: string;
  playerId: string;
  rank: number;
  verified: boolean;
}

export interface SettlementInstruction {
  matchId: string;
  playerId: string;
  rank: number;
  amount: number;
  currency: string;
}

// ------------------------------------------------------------ validation schemas

export const nicknameSchema = z
  .string()
  .trim()
  .min(3)
  .max(16)
  .regex(/^[\p{L}\p{N}_\- ]+$/u, "letters, digits, space, _ and - only");

export const guestLoginSchema = z.object({ nickname: nicknameSchema });

const telemetrySchema = z.object({
  ticks: z.number().int().nonnegative(),
  avgSpeed: z.number(),
  maxSpeed: z.number(),
  maxAcceleration: z.number(),
  maxYawRate: z.number(),
  distance: z.number(),
  inputsReceived: z.number().int().nonnegative(),
  inputsDropped: z.number().int().nonnegative(),
  inputsRejected: z.number().int().nonnegative(),
  packetIntervalMeanMs: z.number(),
  packetIntervalJitterMs: z.number(),
  pingMs: z.number(),
  pingMaxMs: z.number(),
  itemsPicked: z.number().int().nonnegative(),
  itemsUsed: z.number().int().nonnegative(),
  shotsFired: z.number().int().nonnegative(),
  damageDealt: z.number(),
  damageTaken: z.number(),
  wallCollisions: z.number().int().nonnegative(),
  carCollisions: z.number().int().nonnegative(),
  wrecks: z.number().int().nonnegative(),
  disconnects: z.number().int().nonnegative(),
  reconnects: z.number().int().nonnegative(),
});

const suspicionLevelSchema = z.enum([
  "normal",
  "suspicious",
  "flagged",
  "restricted",
  "match_invalidated",
  "temporary_suspension",
  "manual_review",
]);

export const matchOutcomeSchema = z.object({
  matchId: z.uuid(),
  serverId: z.string().min(1).max(64),
  trackId: z.string().min(1).max(64),
  seed: z.number().int(),
  configHash: z.string().length(8),
  tickRate: z.number().int().positive(),
  status: z.enum(["running", "finished", "abandoned", "invalidated"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  endReason: z.string().max(64),
  verified: z.boolean(),
  results: z
    .array(
      z.object({
        slot: z.number().int().min(0).max(31),
        playerId: z.uuid().nullable(),
        nickname: z.string().max(32),
        isBot: z.boolean(),
        rank: z.number().int().positive(),
        status: z.enum(["finished", "dnf", "forfeit"]),
        finishTimeMs: z.number().int().nonnegative().nullable(),
        lapsCompleted: z.number().int().nonnegative(),
        progress: z.number(),
        suspicionScore: z.number().nonnegative(),
        suspicionLevel: suspicionLevelSchema,
        verified: z.boolean(),
        telemetry: telemetrySchema,
        anomalies: z
          .array(z.object({ tick: z.number().int(), kind: z.string().max(32), points: z.number(), detail: z.string().max(256) }))
          .max(500),
      }),
    )
    .max(32),
});

export const matchStartSchema = z.object({
  matchId: z.uuid(),
  serverId: z.string().min(1).max(64),
  trackId: z.string().min(1).max(64),
  seed: z.number().int(),
  configHash: z.string().length(8),
  players: z
    .array(z.object({ slot: z.number().int(), playerId: z.uuid().nullable(), nickname: z.string().max(32), isBot: z.boolean() }))
    .max(32),
});

export type MatchStartPayload = z.infer<typeof matchStartSchema>;
