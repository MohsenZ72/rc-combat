import { Client, type Room } from "@colyseus/sdk";
import { decodeSnapshot, encodeInput, MSG, type GameEvent, type Phase, type Snapshot } from "@rc/shared";
import { Emitter } from "../game/emitter.js";

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:2567";

export interface SeatInfo {
  slot: number;
  nickname: string;
  isBot: boolean;
  color: string;
}

export interface Welcome {
  matchId: string;
  slot: number;
  trackId: string;
  trackName: string;
  configHash: string;
  tickRate: number;
  snapshotDivisor: number;
  laps: number;
  seats: SeatInfo[];
}

export interface ResultsMessage {
  matchId: string;
  status: string;
  endReason: string;
  results: {
    slot: number;
    nickname: string;
    isBot: boolean;
    rank: number;
    status: "finished" | "dnf" | "forfeit";
    finishTimeMs: number | null;
    lapsCompleted: number;
    verified: boolean;
  }[];
}

export interface LobbyState {
  phase: Phase;
  lobbyEndsAt: number;
  minPlayers: number;
  maxPlayers: number;
  players: SeatInfo[];
}

type NetEvents = {
  welcome: Welcome;
  snapshot: Snapshot;
  events: GameEvent[];
  results: ResultsMessage;
  lobby: LobbyState;
  connection: "connected" | "reconnecting" | "closed";
  closed: { code: number; reason?: string };
};

interface RawPlayer {
  slot: number;
  nickname: string;
  color: string;
  isBot: boolean;
}

interface RawState {
  phase: number;
  lobbyEndsAt: number;
  minPlayers: number;
  maxPlayers: number;
  players: { forEach(cb: (p: RawPlayer, key: string) => void): void };
}

/** Network adapter: matchmaking, message decoding, input sending, reconnection. */
export class Connection extends Emitter<NetEvents> {
  private room: Room | null = null;
  private malformed = 0;

  /** `track` is a track id or "any"; the server matches players per choice. */
  async join(token: string, track = "any"): Promise<void> {
    const client = new Client(GAME_SERVER_URL);
    client.auth.token = token;
    const room = await client.joinOrCreate("race", { track });
    this.room = room;
    room.onMessage(MSG.WELCOME, (w: Welcome) => this.emit("welcome", w));
    room.onMessage(MSG.SNAPSHOT, (bytes: Uint8Array) => {
      const decoded = decodeSnapshot(bytes);
      if (decoded.ok) this.emit("snapshot", decoded.value);
      else this.malformed++;
    });
    room.onMessage(MSG.EVENT, (events: GameEvent[]) => this.emit("events", events));
    room.onMessage(MSG.RESULTS, (r: ResultsMessage) => this.emit("results", r));
    room.onMessage(MSG.REJECTED, () => undefined);
    room.onMessage(MSG.PING, (p: { t: number }) => room.send(MSG.PONG, p));
    room.onStateChange((state: RawState) => {
      const players: SeatInfo[] = [];
      state.players.forEach((p) => players.push({ slot: p.slot, nickname: p.nickname, color: p.color, isBot: p.isBot }));
      players.sort((a, b) => a.slot - b.slot);
      this.emit("lobby", {
        phase: state.phase as Phase,
        lobbyEndsAt: state.lobbyEndsAt,
        minPlayers: state.minPlayers,
        maxPlayers: state.maxPlayers,
        players,
      });
    });
    room.onDrop(() => this.emit("connection", "reconnecting"));
    room.onReconnect(() => this.emit("connection", "connected"));
    room.onLeave((code, reason) => {
      this.room = null;
      this.emit("connection", "closed");
      this.emit("closed", { code, ...(reason ? { reason } : {}) });
    });
    this.emit("connection", "connected");
  }

  sendInput(seq: number, buttons: number): void {
    this.room?.sendBytes(MSG.INPUT, encodeInput(seq, buttons));
  }

  get connected(): boolean {
    return this.room !== null;
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) await room.leave(true).catch(() => undefined);
  }
}
