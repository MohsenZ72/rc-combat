import { BTN, DEFAULT_CONFIG, encodeInput, matchOutcomeSchema, mergeConfig, Phase } from "@rc/shared";
import { loadRapier, Track, verifyReplay, WORKSHOP_CIRCUIT } from "@rc/game-core";
import { describe, expect, it } from "vitest";
import { MatchSession } from "../src/match/match-session.js";

const rapier = await loadRapier();
const track = new Track(WORKSHOP_CIRCUIT);
const PLAYER_A = "11111111-1111-4111-8111-111111111111";
const PLAYER_B = "22222222-2222-4222-8222-222222222222";

/** Crude driver for scripted humans: full throttle, steer towards the centreline ahead. */
function follow(session: MatchSession, slot: number): number {
  const car = session.sim!.cars[slot]!;
  const proj = track.project(car.x, car.y, car.segmentHint);
  const aim = track.poseAt(proj.s + 12);
  const diff = Math.atan2(aim.y - car.y, aim.x - car.x) - car.heading;
  const d = Math.atan2(Math.sin(diff), Math.cos(diff));
  return BTN.ACCELERATE | (d > 0.05 ? BTN.STEER_LEFT : d < -0.05 ? BTN.STEER_RIGHT : 0);
}

function newSession(config = DEFAULT_CONFIG) {
  return new MatchSession({ rapier, track, config, serverId: "test", seed: 3 });
}

/** Drives a session like the room does: one input per human per tick at 30 Hz. */
function run(session: MatchSession, ticks: number, buttonsFor: (slot: number, tick: number) => number | null, startMs = 0) {
  let now = startMs;
  const dt = 1000 / session.config.net.tickRate;
  const seqs = new Map<number, number>();
  for (let i = 0; i < ticks && session.phase === "running"; i++) {
    now += dt;
    for (const seat of session.seats) {
      if (seat.isBot || !seat.connected || seat.gone) continue;
      const b = buttonsFor(seat.slot, i);
      if (b === null) continue;
      const seq = (seqs.get(seat.slot) ?? 0) + 1;
      seqs.set(seat.slot, seq);
      session.onInput(seat.slot, encodeInput(seq, b), now);
    }
    session.step(now);
  }
  return now;
}

describe("MatchSession", () => {
  it("rejects a second seat for the same account", () => {
    const s = newSession();
    s.addHuman(PLAYER_A, "alice", 0);
    expect(() => s.addHuman(PLAYER_A, "alice", 0)).toThrow(/already/);
  });

  it("refuses late joins once the match started", () => {
    const s = newSession();
    s.addHuman(PLAYER_A, "alice", 0);
    s.start(true, 0);
    expect(() => s.addHuman(PLAYER_B, "bob", 0)).toThrow(/started/);
    s.dispose();
  });

  it("fills empty seats with bots and runs a verified full match", () => {
    const s = newSession();
    s.addHuman(PLAYER_A, "alice", 0);
    const start = s.start(true, 0);
    expect(start.players).toHaveLength(10);
    // The human just holds throttle and steers with a crude follow-the-track rule.
    run(s, 30 * 400, (slot) => follow(s, slot));
    expect(s.phase).toBe("finished");
    const { outcome, replay } = s.outcome();
    expect(matchOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(outcome.status).toBe("finished");
    expect(outcome.verified).toBe(true);
    expect(outcome.results).toHaveLength(10);
    expect(outcome.results.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const human = outcome.results.find((r) => r.playerId === PLAYER_A)!;
    expect(human.suspicionLevel).toBe("normal");
    expect(human.telemetry.inputsReceived).toBeGreaterThan(1000);
    expect(verifyReplay(rapier, JSON.parse(JSON.stringify(replay)), WORKSHOP_CIRCUIT).ok).toBe(true);
    s.dispose();
  });

  it("fake finish / score / health messages are rejected and counted, state unchanged", () => {
    const s = newSession();
    const seat = s.addHuman(PLAYER_A, "alice", 0);
    s.start(false, 0);
    run(s, 200, () => BTN.ACCELERATE);
    const car = s.sim!.cars[seat.slot]!;
    const before = { hp: car.hp, lap: car.lap, finished: car.finished, rank: car.rank };
    for (const type of ["finish", "setScore", "setHealth", "setPosition", 99]) s.onForbiddenMessage(seat.slot, type, 1000);
    s.step(1000);
    expect({ hp: car.hp, lap: car.lap, finished: car.finished, rank: car.rank }).toEqual(before);
    expect(s.sim!.suspicion[seat.slot]!.counts.get("forbidden_message")).toBe(5);
    s.dispose();
  });

  it("kicks a client that keeps sending garbage", () => {
    const s = newSession();
    const seat = s.addHuman(PLAYER_A, "alice", 0);
    s.start(false, 0);
    let kick = false;
    for (let i = 0; i < 100 && !kick; i++) kick = s.onInput(seat.slot, { hp: 100 }, 1000 + i);
    expect(kick).toBe(true);
    s.dispose();
  });

  it("a dropped player coasts with neutral input and can reconnect", () => {
    const s = newSession();
    const a = s.addHuman(PLAYER_A, "alice", 0);
    s.addHuman(PLAYER_B, "bob", 0);
    s.start(false, 0);
    let now = run(s, 200, (slot) => follow(s, slot));
    s.drop(a.slot);
    now = run(s, 90, (slot) => follow(s, slot), now);
    const car = s.sim!.cars[a.slot]!;
    // The server applied neutral input while the player was away (no free advantage, no ghost).
    expect(car.lastButtons).toBe(0);
    expect(car.disconnected).toBe(true);
    s.reconnect(a.slot);
    run(s, 60, (slot) => follow(s, slot), now);
    expect(car.disconnected).toBe(false);
    expect(car.lastButtons & BTN.ACCELERATE).toBe(BTN.ACCELERATE);
    s.dispose();
  });

  it("a player who leaves mid-race forfeits and ranks last", () => {
    const s = newSession(mergeConfig(DEFAULT_CONFIG, { race: { maxRaceSeconds: 20 } }));
    const a = s.addHuman(PLAYER_A, "alice", 0);
    s.addHuman(PLAYER_B, "bob", 0);
    s.start(false, 0);
    const now = run(s, 200, () => BTN.ACCELERATE);
    s.leave(a.slot, "left");
    run(s, 30 * 30, () => BTN.ACCELERATE, now);
    const { outcome } = s.outcome();
    const alice = outcome.results.find((r) => r.playerId === PLAYER_A)!;
    expect(alice.status).toBe("forfeit");
    expect(alice.rank).toBe(2);
    s.dispose();
  });

  it("an AFK player is timed out", () => {
    const s = newSession();
    s.addHuman(PLAYER_A, "alice", 0);
    s.addHuman(PLAYER_B, "bob", 0);
    s.start(false, 0);
    // Alice never sends anything after the start.
    run(s, 30 * 70, (slot) => (slot === 0 ? null : BTN.ACCELERATE));
    expect(s.seats[0]!.gone).toBe(true);
    expect(s.sim!.cars[0]!.forfeited).toBe(true);
    s.dispose();
  });

  it("abandoned matches are not verified", () => {
    const s = newSession();
    const a = s.addHuman(PLAYER_A, "alice", 0);
    s.start(true, 0);
    run(s, 300, () => BTN.ACCELERATE);
    s.leave(a.slot, "left");
    s.abandon(20000);
    const { outcome } = s.outcome();
    expect(outcome.status).toBe("abandoned");
    expect(outcome.verified).toBe(false);
    expect(s.sim!.phase).toBe(Phase.Finished);
    s.dispose();
  });

  it("a cheating player's result is unverified and the match invalidated", () => {
    const s = newSession();
    const a = s.addHuman(PLAYER_A, "alice", 0);
    s.start(true, 0);
    run(s, 200, () => BTN.ACCELERATE);
    for (let i = 0; i < 4; i++) s.sim!.reportAnomaly(a.slot, "teleport", "test");
    s.abandon(10000);
    const { outcome } = s.outcome();
    const alice = outcome.results.find((r) => r.playerId === PLAYER_A)!;
    expect(alice.verified).toBe(false);
    expect(alice.suspicionLevel).toBe("temporary_suspension");
    s.dispose();
  });

  it("pong echoes the server cannot have sent are ignored", () => {
    const s = newSession();
    const a = s.addHuman(PLAYER_A, "alice", 0);
    s.start(false, 0);
    s.onPong(a.slot, { t: 123 }, 200);
    expect(s.seats[0]!.pingMs).toBe(0);
    const ping = s.makePing(a.slot, 1000)!;
    s.onPong(a.slot, ping, 1080);
    expect(s.seats[0]!.pingMs).toBe(80);
    s.dispose();
  });
});
