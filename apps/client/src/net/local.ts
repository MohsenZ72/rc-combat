import { DEFAULT_CONFIG, decodeSnapshot, encodeInput, Phase, type Cosmetics, type GameEvent } from "@rc/shared";
import { configForTrack, MatchSession, TRACK_IDS, type Rapier, type Track } from "@rc/game-core";
import { Emitter } from "../game/emitter.js";
import type { LobbyState, NetEvents, ResultsMessage, SeatInfo, Welcome } from "./connection.js";

/** How long the offline "lobby" shows the grid before the countdown starts. */
const LOBBY_MS = 1500;
/** Steps run at most per timer callback (a throttled background tab pauses instead of fast-forwarding). */
const MAX_CATCH_UP = 5;

export interface LocalPlayer {
  nickname: string;
  cosmetics: Cosmetics;
}

/**
 * Offline races against bots, entirely in the browser. Runs the same
 * framework-free `MatchSession` the game server runs (simulation, bots, input
 * guard, anti-cheat, replay) and speaks the same messages as `Connection`, so
 * `RaceClient` cannot tell the difference. Used by the static GitHub Pages
 * build, where there is no server, and by "Practice offline".
 */
export class LocalConnection extends Emitter<NetEvents> {
  private session: MatchSession | null = null;
  private slot = -1;
  private timer: number | null = null;
  private startTimer: number | null = null;
  private nextStepAt = 0;
  private lastPhase: Phase = Phase.Lobby;
  private finished = false;

  constructor(
    private readonly rapier: Rapier,
    private readonly trackFor: (id: string) => Track,
    private readonly player: LocalPlayer,
  ) {
    super();
  }

  async join(_token: string, track = "any"): Promise<void> {
    const id = (TRACK_IDS as readonly string[]).includes(track) ? track : TRACK_IDS[Math.floor(Math.random() * TRACK_IDS.length)]!;
    const t = this.trackFor(id);
    const session = new MatchSession({ rapier: this.rapier, track: t, config: configForTrack(DEFAULT_CONFIG, t.def), serverId: "browser" });
    this.session = session;
    this.finished = false;
    const seat = session.addHuman(globalThis.crypto.randomUUID(), this.player.nickname, Date.now(), this.player.cosmetics);
    this.slot = seat.slot;
    this.emit("connection", "connected");
    this.emit("welcome", session.welcome(seat.slot) as unknown as Welcome);
    this.emitLobby(Phase.Lobby, Date.now() + LOBBY_MS);
    this.startTimer = window.setTimeout(() => this.start(), LOBBY_MS);
  }

  private start(): void {
    const session = this.session;
    if (!session) return;
    session.start(true, Date.now());
    // Seats were re-packed with bots; our slot may have changed.
    this.slot = session.seats.find((s) => !s.isBot)?.slot ?? 0;
    this.lastPhase = Phase.Countdown;
    this.emitLobby(Phase.Countdown, 0);
    this.emit("welcome", session.welcome(this.slot) as unknown as Welcome);
    const tickMs = 1000 / session.config.net.tickRate;
    this.nextStepAt = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      for (let n = 0; n < MAX_CATCH_UP && now >= this.nextStepAt; n++) {
        this.tick();
        this.nextStepAt += tickMs;
      }
      if (now - this.nextStepAt > tickMs * MAX_CATCH_UP) this.nextStepAt = now;
    }, tickMs / 2);
  }

  private tick(): void {
    const session = this.session;
    if (!session || session.phase !== "running" || this.finished) return;
    const out = session.step(Date.now());
    const phase = session.sim!.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.emitLobby(phase, 0);
    }
    const events: GameEvent[] = [...out.publicEvents, ...(out.privateEvents.get(this.slot) ?? [])];
    if (events.length > 0) this.emit("events", events);
    if (out.snapshot) {
      const decoded = decodeSnapshot(session.snapshotFor(this.slot, out.snapshot));
      if (decoded.ok) this.emit("snapshot", decoded.value);
    }
    if (out.finished) this.finish();
  }

  private finish(): void {
    const session = this.session;
    if (!session || this.finished) return;
    this.finished = true;
    this.stopTimers();
    const { outcome } = session.outcome();
    const results: ResultsMessage = {
      matchId: outcome.matchId,
      status: outcome.status,
      endReason: outcome.endReason,
      results: outcome.results.map((r) => ({
        slot: r.slot,
        nickname: r.nickname,
        isBot: r.isBot,
        rank: r.rank,
        status: r.status,
        finishTimeMs: r.finishTimeMs,
        lapsCompleted: r.lapsCompleted,
        verified: r.verified,
      })),
    };
    this.emit("results", results);
  }

  private emitLobby(phase: Phase, lobbyEndsAt: number): void {
    const session = this.session;
    if (!session) return;
    const players: SeatInfo[] = session.seats.map((s) => ({ slot: s.slot, nickname: s.nickname, color: s.color, isBot: s.isBot }));
    const state: LobbyState = { phase, lobbyEndsAt, minPlayers: 1, maxPlayers: session.config.maxPlayers, players };
    this.emit("lobby", state);
  }

  sendInput(seq: number, buttons: number): void {
    if (this.session && this.slot >= 0) this.session.onInput(this.slot, encodeInput(seq, buttons), Date.now());
  }

  get connected(): boolean {
    return this.session !== null;
  }

  async leave(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.stopTimers();
    this.session = null;
    session.dispose();
    this.emit("connection", "closed");
    this.emit("closed", { code: 4000 });
  }

  private stopTimers(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.timer = null;
    this.startTimer = null;
  }
}
