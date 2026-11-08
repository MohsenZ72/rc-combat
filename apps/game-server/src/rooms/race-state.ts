import { schema, t } from "@colyseus/schema";

/**
 * Low-frequency room state synced by Colyseus (lobby roster, phase). Car
 * kinematics travel separately as compact binary snapshots.
 */
export const PlayerInfo = schema(
  {
    slot: t.uint8(),
    nickname: t.string(),
    color: t.string(),
    isBot: t.boolean(),
    connected: t.boolean(),
  },
  "PlayerInfo",
);

export const RaceState = schema(
  {
    /** 0 lobby, 1 countdown, 2 racing, 3 finished (shared Phase enum). */
    phase: t.uint8(),
    matchId: t.string(),
    trackId: t.string(),
    laps: t.uint8(),
    minPlayers: t.uint8(),
    maxPlayers: t.uint8(),
    /** Epoch ms when the lobby starts the race, 0 when not scheduled. */
    lobbyEndsAt: t.float64(),
    players: t.map(PlayerInfo),
  },
  "RaceState",
);

export type PlayerInfoT = InstanceType<typeof PlayerInfo>;
export type RaceStateT = InstanceType<typeof RaceState>;
