import { Room, ServerError, type AuthContext, type Client } from "colyseus";
import { MSG, Phase, type GameConfig } from "@rc/shared";
import type { Rapier, Track } from "@rc/game-core";
import type { BackendPort } from "../api-client.js";
import { AuthError, type AuthenticatedPlayer, type TokenVerifier } from "../auth.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { MatchSession } from "../match/match-session.js";
import { metrics } from "../metrics.js";
import { PlayerInfo, RaceState, type RaceStateT } from "./race-state.js";

export interface RoomDeps {
  env: Env;
  config: GameConfig;
  rapier: Rapier;
  track: Track;
  verifier: TokenVerifier;
  backend: BackendPort;
  log: Logger;
}

type RaceClient = Client<{ userData: { playerId: string }; auth: AuthenticatedPlayer }>;

/** Close codes sent to clients so the UI can explain what happened. */
export const CLOSE = { KICKED: 4003, DUPLICATE: 4009, MATCH_OVER: 4000 } as const;

/**
 * Colyseus adapter around MatchSession: authentication, lobby timing,
 * message routing, reconnection and result upload. Game rules live in
 * MatchSession / RaceSimulation, not here.
 */
export class RaceRoom extends Room<{ state: RaceStateT; client: RaceClient }> {
  static deps: RoomDeps;

  private session!: MatchSession;
  private lobbyTimer: { clear(): void } | null = null;
  private finalized = false;
  private log!: Logger;

  /** Runs before a seat is reserved: invalid or suspended sessions never reach the room. */
  static override async onAuth(token: string, _options: unknown, context: AuthContext): Promise<AuthenticatedPlayer> {
    try {
      return await RaceRoom.deps.verifier.verify(token ?? context.token);
    } catch (err) {
      if (err instanceof AuthError) throw new ServerError(401, err.message);
      RaceRoom.deps.log.error({ err: (err as Error).message }, "auth backend error");
      throw new ServerError(503, "auth unavailable");
    }
  }

  override onCreate(): void {
    const { env, config, rapier, track } = RaceRoom.deps;
    this.maxClients = env.MAX_PLAYERS;
    this.session = new MatchSession({ rapier, track, config, serverId: env.GAME_SERVER_ID });
    this.log = RaceRoom.deps.log.child({ matchId: this.session.matchId, roomId: this.roomId });
    const state = new RaceState();
    state.phase = Phase.Lobby;
    state.matchId = this.session.matchId;
    state.trackId = track.def.id;
    state.laps = config.race.laps;
    state.minPlayers = env.MIN_PLAYERS;
    state.maxPlayers = env.MAX_PLAYERS;
    state.lobbyEndsAt = 0;
    this.state = state;
    this.setPatchRate(200);
    metrics.rooms++;

    // Hard transport-level cap; the InputGuard token bucket handles finer-grained flooding.
    this.maxMessagesPerSecond = config.net.tickRate * 4 + 10;
    const onInput = (client: RaceClient, payload: unknown) => {
      metrics.recordIn(byteLength(payload));
      const seat = this.seatOf(client);
      if (seat && this.session.onInput(seat.slot, payload, Date.now())) this.kick(client, "protocol violations");
    };
    this.onMessageBytes(MSG.INPUT, onInput);
    // A JSON-encoded INPUT is malformed by definition; the guard rejects and counts it.
    this.onMessage(MSG.INPUT, onInput);
    this.onMessage(MSG.PONG, (client, payload: unknown) => {
      const seat = this.seatOf(client);
      if (seat) this.session.onPong(seat.slot, payload, Date.now());
    });
    // Every other message (e.g. "finish", "setScore", "setHealth", or a known type in the
    // wrong encoding) is a protocol violation: counted, scored and eventually kicked.
    this.onMessage("*", (client, type) => {
      const seat = this.seatOf(client);
      if (!seat) return;
      this.log.warn({ slot: seat.slot, type: String(type).slice(0, 32) }, "forbidden client message");
      if (this.session.onForbiddenMessage(seat.slot, type, Date.now())) this.kick(client, "forbidden messages");
    });

    this.setFixedTimestep(() => this.tick(), config.net.tickRate);
    this.clock.setInterval(() => this.sendPings(), config.net.pingIntervalMs);
    this.log.info("room created");
  }

  override onJoin(client: RaceClient, _options: unknown, auth: AuthenticatedPlayer): void {
    if (this.session.findByPlayer(auth.playerId)) {
      throw new ServerError(CLOSE.DUPLICATE, "already in this match");
    }
    const seat = this.session.addHuman(auth.playerId, auth.nickname, Date.now());
    client.userData = { playerId: auth.playerId };
    this.state.players.set(auth.playerId, new PlayerInfo({ slot: seat.slot, nickname: seat.nickname, color: seat.color, isBot: false, connected: true }));
    client.send(MSG.WELCOME, this.session.welcome(seat.slot));
    metrics.players++;
    this.log.info({ slot: seat.slot, playerId: auth.playerId }, "player joined");
    this.updateLobby();
  }

  override onDrop(client: RaceClient): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    if (this.session.phase !== "running") {
      // Nothing to hold in the lobby; the seat is released in onLeave.
      return;
    }
    this.session.drop(seat.slot);
    this.setConnected(client, false);
    this.log.info({ slot: seat.slot }, "player dropped, holding seat");
    this.allowReconnection(client, RaceRoom.deps.env.RECONNECT_SECONDS);
  }

  override onReconnect(client: RaceClient): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    this.session.reconnect(seat.slot);
    this.setConnected(client, true);
    client.send(MSG.WELCOME, this.session.welcome(seat.slot));
    this.log.info({ slot: seat.slot }, "player reconnected");
  }

  override onLeave(client: RaceClient): void {
    const seat = this.seatOf(client);
    metrics.players = Math.max(0, metrics.players - 1);
    if (!seat) return;
    const playerId = client.userData?.playerId;
    if (this.session.phase === "lobby") {
      this.session.removeFromLobby(seat.slot);
      if (playerId) this.state.players.delete(playerId);
      this.updateLobby();
      return;
    }
    if (this.session.phase === "running") {
      this.session.leave(seat.slot, "left");
      this.setConnected(client, false);
      this.log.info({ slot: seat.slot }, "player left the race");
      // Nobody left to play for: end now rather than simulating an empty match.
      if (this.session.humans.every((h) => h.gone)) {
        this.session.abandon(Date.now());
        void this.finalize();
      }
    }
  }

  override async onDispose(): Promise<void> {
    metrics.rooms = Math.max(0, metrics.rooms - 1);
    if (this.session.phase === "running") {
      // Server shutdown or room disposal mid-race: record it as abandoned.
      this.session.abandon(Date.now());
    }
    if (this.session.phase === "finished") await this.finalize();
    if (this.session.sim) metrics.activeMatches = Math.max(0, metrics.activeMatches - 1);
    this.session.dispose();
    this.lobbyTimer?.clear();
    this.log.info("room disposed");
  }

  // ---------------------------------------------------------------- lobby

  private updateLobby(): void {
    if (this.session.phase !== "lobby") return;
    const { env } = RaceRoom.deps;
    const humans = this.session.humans.length;
    if (humans >= env.MAX_PLAYERS) {
      void this.startMatch();
      return;
    }
    if (humans >= env.MIN_PLAYERS && !this.lobbyTimer) {
      this.state.lobbyEndsAt = Date.now() + env.LOBBY_WAIT_SECONDS * 1000;
      this.lobbyTimer = this.clock.setTimeout(() => void this.startMatch(), env.LOBBY_WAIT_SECONDS * 1000);
    } else if (humans < env.MIN_PLAYERS && this.lobbyTimer) {
      this.lobbyTimer.clear();
      this.lobbyTimer = null;
      this.state.lobbyEndsAt = 0;
    }
  }

  private async startMatch(): Promise<void> {
    if (this.session.phase !== "lobby" || this.session.humans.length === 0) return;
    this.lobbyTimer?.clear();
    this.lobbyTimer = null;
    // No late joining: from here on, matchmaking sends new players to a new room.
    await this.lock();
    const payload = this.session.start(RaceRoom.deps.env.FILL_WITH_BOTS, Date.now());
    metrics.activeMatches++;
    this.state.lobbyEndsAt = 0;
    this.state.phase = Phase.Countdown;
    // Seats were re-packed; refresh roster and slots for everyone.
    this.state.players.clear();
    for (const seat of this.session.seats) {
      const key = seat.playerId ?? `bot-${seat.slot}`;
      this.state.players.set(key, new PlayerInfo({ slot: seat.slot, nickname: seat.nickname, color: seat.color, isBot: seat.isBot, connected: seat.connected }));
    }
    for (const client of this.clients) {
      const seat = this.seatOf(client);
      if (seat) client.send(MSG.WELCOME, this.session.welcome(seat.slot));
    }
    this.log.info({ players: payload.players.length, seed: payload.seed }, "match started");
    void RaceRoom.deps.backend.matchStarted(payload);
  }

  // ---------------------------------------------------------------- loop

  private tick(): void {
    if (this.session.phase !== "running") return;
    const t0 = performance.now();
    const out = this.session.step(Date.now());
    const sim = this.session.sim!;
    if (this.state.phase !== sim.phase) this.state.phase = sim.phase;

    if (out.publicEvents.length > 0) this.broadcast(MSG.EVENT, out.publicEvents);
    for (const client of this.clients) {
      const seat = this.seatOf(client);
      if (!seat) continue;
      const priv = out.privateEvents.get(seat.slot);
      if (priv) client.send(MSG.EVENT, priv);
      if (out.snapshot) {
        const bytes = this.session.snapshotFor(seat.slot, out.snapshot);
        client.sendBytes(MSG.SNAPSHOT, bytes);
        metrics.recordOut(bytes.byteLength);
      }
    }
    metrics.recordTick(performance.now() - t0);
    if (out.finished) void this.finalize();
  }

  private sendPings(): void {
    const now = Date.now();
    for (const client of this.clients) {
      const seat = this.seatOf(client);
      const ping = seat ? this.session.makePing(seat.slot, now) : null;
      if (ping) client.send(MSG.PING, ping);
    }
  }

  // ---------------------------------------------------------------- results

  private async finalize(): Promise<void> {
    if (this.finalized || !this.session.sim) return;
    this.finalized = true;
    this.state.phase = Phase.Finished;
    const { outcome, replay } = this.session.outcome();
    metrics.matchesFinished++;
    // Players see ranks and their own verification; anomaly details stay server-side.
    this.broadcast(MSG.RESULTS, {
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
    });
    const flagged = outcome.results.filter((r) => r.suspicionLevel !== "normal");
    this.log.info({ status: outcome.status, endReason: outcome.endReason, flagged: flagged.length }, "match finished");
    await RaceRoom.deps.backend.matchFinished(outcome, replay);
    this.clock.setTimeout(() => void this.disconnect(CLOSE.MATCH_OVER), RaceRoom.deps.env.RESULTS_LINGER_SECONDS * 1000);
  }

  // ---------------------------------------------------------------- helpers

  private seatOf(client: RaceClient) {
    const playerId = client.userData?.playerId;
    return playerId ? this.session.findByPlayer(playerId) ?? this.session.seats.find((s) => s.playerId === playerId) : undefined;
  }

  private setConnected(client: RaceClient, connected: boolean): void {
    const info = client.userData ? this.state.players.get(client.userData.playerId) : undefined;
    if (info) info.connected = connected;
  }

  private kick(client: RaceClient, reason: string): void {
    const seat = this.seatOf(client);
    this.log.warn({ slot: seat?.slot, reason }, "kicking client");
    metrics.kicks++;
    if (seat) this.session.leave(seat.slot, "kicked");
    client.leave(CLOSE.KICKED, reason);
  }
}

function byteLength(payload: unknown): number {
  if (ArrayBuffer.isView(payload) || payload instanceof ArrayBuffer) return payload.byteLength;
  return 0;
}
