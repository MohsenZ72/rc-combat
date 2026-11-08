import { BTN, CLIENT_MESSAGE_TYPES, DEFAULT_CONFIG, decodeInput, encodeInput, ItemKind, MSG } from "@rc/shared";
import { describe, expect, it } from "vitest";
import { BotDriver, InputGuard, processGates, speedOf, SuspicionTracker, validateMovement, type KinematicSample } from "../src/index.js";
import { anomalies, makeSim, startRace, stepN, track } from "./helpers.js";

const dt = 1 / DEFAULT_CONFIG.net.tickRate;
const ctx = (over: Partial<Parameters<typeof validateMovement>[2]> = {}) => ({
  dt,
  config: DEFAULT_CONFIG,
  track,
  turbo: false,
  impulse: false,
  respawned: false,
  prevSpeedCap: DEFAULT_CONFIG.car.maxSpeed,
  ...over,
});

function sampleOnTrack(speed: number): KinematicSample {
  const pose = track.poseAt(200);
  return { x: pose.x, y: pose.y, heading: pose.heading, vx: Math.cos(pose.heading) * speed, vy: Math.sin(pose.heading) * speed };
}

function advance(s: KinematicSample, speed: number, distance = speed * dt): KinematicSample {
  return {
    ...s,
    x: s.x + Math.cos(s.heading) * distance,
    y: s.y + Math.sin(s.heading) * distance,
    vx: Math.cos(s.heading) * speed,
    vy: Math.sin(s.heading) * speed,
  };
}

describe("movement validation", () => {
  it("accepts normal movement", () => {
    const prev = sampleOnTrack(25);
    const verdict = validateMovement(prev, advance(prev, 25.3), ctx());
    expect(verdict.violations).toEqual([]);
    expect(verdict.corrected).toBeNull();
  });

  it("accepts a full honest 10-bot race with zero anomalies", async () => {
    const sim = await makeSim({ slots: 10, seed: 9 });
    const bots = Array.from({ length: 10 }, (_, i) => new BotDriver(i, 9, 0.5 + (i % 4) * 0.1));
    const flagged: unknown[] = [];
    const inputs = new Array(10).fill(0);
    while (sim.phase !== 3 && sim.tick < 12000) {
      for (const b of bots) inputs[b.slot] = b.decide({ track, cars: sim.cars, tickRate: sim.tickRate });
      sim.step(inputs);
      flagged.push(...sim.drainEvents().filter((e) => e.type === "anomaly"));
    }
    expect(sim.endReason).toBe("all_finished");
    expect(flagged).toEqual([]);
    sim.dispose();
  });

  it("rejects and corrects a speed hack", () => {
    const prev = sampleOnTrack(29);
    const next = advance(prev, 60, 29 * dt);
    const verdict = validateMovement(prev, next, ctx());
    expect(verdict.violations.map((v) => v.kind)).toContain("speed");
    expect(Math.hypot(verdict.corrected!.vx, verdict.corrected!.vy)).toBeLessThanOrEqual(DEFAULT_CONFIG.car.maxSpeed + 1e-6);
  });

  it("rejects impossible acceleration", () => {
    const prev = sampleOnTrack(5);
    const verdict = validateMovement(prev, advance(prev, 25), ctx());
    expect(verdict.violations.map((v) => v.kind)).toContain("acceleration");
  });

  it("rejects impossible rotation", () => {
    const prev = sampleOnTrack(20);
    const next = { ...advance(prev, 20), heading: prev.heading + 1.2 };
    const verdict = validateMovement(prev, next, ctx());
    expect(verdict.violations.map((v) => v.kind)).toContain("rotation");
  });

  it("rejects and reverts a teleport", () => {
    const prev = sampleOnTrack(20);
    const next = advance(prev, 20, 40);
    const verdict = validateMovement(prev, next, ctx());
    expect(verdict.violations.map((v) => v.kind)).toContain("teleport");
    expect(verdict.corrected!.x).toBeCloseTo(prev.x);
    expect(verdict.corrected!.y).toBeCloseTo(prev.y);
  });

  it("reverts a sideways teleport through the wall", () => {
    const prev = sampleOnTrack(10);
    const out = { ...prev, x: prev.x - Math.sin(prev.heading) * 30, y: prev.y + Math.cos(prev.heading) * 30 };
    const verdict = validateMovement(prev, out, ctx());
    expect(verdict.violations.map((v) => v.kind)).toContain("teleport");
    const c = verdict.corrected!;
    expect(Math.abs(track.project(c.x, c.y).lateral)).toBeLessThan(track.halfWidth);
  });

  it("detects wall clipping and requests a respawn", () => {
    const base = sampleOnTrack(2);
    const lx = -Math.sin(base.heading);
    const ly = Math.cos(base.heading);
    const inWall = track.halfWidth + 0.5;
    const prev = { ...base, x: base.x + lx * inWall, y: base.y + ly * inWall };
    const next = advance(prev, 2);
    const verdict = validateMovement(prev, next, ctx());
    expect(verdict.violations.map((v) => v.kind)).toContain("wall_clip");
    expect(verdict.respawn).toBe(true);
  });

  it("flags non-finite state", () => {
    const prev = sampleOnTrack(10);
    const verdict = validateMovement(prev, { ...prev, x: Number.NaN }, ctx());
    expect(verdict.violations[0]!.kind).toBe("invalid_state");
    expect(verdict.respawn).toBe(true);
  });

  it("corrects corrupted state inside the live simulation", async () => {
    const sim = await makeSim();
    startRace(sim);
    stepN(sim, 60, [BTN.ACCELERATE, BTN.ACCELERATE]);
    const car = sim.cars[0]!;
    const before = { x: car.x, y: car.y };
    // Simulate an exploit that corrupts the authoritative state.
    car.x += 80;
    car.vx += 100;
    sim.step([BTN.ACCELERATE, BTN.ACCELERATE]);
    const kinds = anomalies(sim).map((e) => (e.type === "anomaly" ? e.kind : ""));
    expect(kinds).toContain("teleport");
    expect(Math.hypot(car.x - before.x, car.y - before.y)).toBeLessThan(5);
    expect(speedOf(car)).toBeLessThanOrEqual(DEFAULT_CONFIG.car.maxSpeed * 1.01);
    sim.dispose();
  });
});

describe("input layer", () => {
  it("speed hack by input flooding gains no distance", async () => {
    const honest = await makeSim({ slots: 1 });
    const cheater = await makeSim({ slots: 1 });
    startRace(honest);
    startRace(cheater);
    const guard = new InputGuard(DEFAULT_CONFIG.net, 0);
    let seq = 0;
    let now = 0;
    for (let t = 0; t < 120; t++) {
      now += 1000 / 30;
      // Cheater sends 10 inputs per tick; server still consumes one per tick.
      for (let k = 0; k < 10; k++) guard.receive(encodeInput(++seq, BTN.ACCELERATE), now);
      const input = guard.take();
      cheater.step([input?.buttons ?? 0]);
      honest.step([BTN.ACCELERATE]);
    }
    const dHonest = honest.cars[0]!.progress;
    const dCheat = cheater.cars[0]!.progress;
    expect(dCheat).toBeLessThanOrEqual(dHonest + 1e-6);
    expect(guard.dropped).toBeGreaterThan(0);
    honest.dispose();
    cheater.dispose();
  });

  it("rejects malformed packets and unknown button bits", () => {
    const guard = new InputGuard(DEFAULT_CONFIG.net, 0);
    expect(guard.receive({ x: 1, y: 2 }, 1).accepted).toBe(false);
    expect(guard.receive(new Uint8Array([1, 0, 0xff]), 2).accepted).toBe(false);
    expect(guard.receive(new Uint8Array([1, 0, 1, 99, 99]), 3).accepted).toBe(false);
    expect(guard.receive(encodeInput(1, BTN.ACCELERATE), 4).accepted).toBe(true);
  });

  it("rejects replayed (duplicate or old) input packets", () => {
    const guard = new InputGuard(DEFAULT_CONFIG.net, 0);
    const pkt = encodeInput(500, BTN.FIRE);
    expect(guard.receive(pkt, 1).accepted).toBe(true);
    expect(guard.receive(pkt, 2).accepted).toBe(false);
    expect(guard.receive(encodeInput(499, BTN.FIRE), 3).accepted).toBe(false);
    expect(guard.receive(encodeInput(501, BTN.FIRE), 4).accepted).toBe(true);
    // 16-bit wrap-around is still accepted.
    const g2 = new InputGuard(DEFAULT_CONFIG.net, 0);
    expect(g2.receive(encodeInput(65535, 0), 1).accepted).toBe(true);
    expect(g2.receive(encodeInput(0, 0), 2).accepted).toBe(true);
  });

  it("fake finish / score / health / position requests have no message type", () => {
    expect([...CLIENT_MESSAGE_TYPES].sort()).toEqual([MSG.INPUT, MSG.PONG].sort());
    // A payload trying to smuggle state through the INPUT channel is rejected.
    for (const fake of [{ finished: true }, { score: 9999 }, { hp: 100 }, { x: 0, y: 0 }, "finish", new Uint8Array(64)]) {
      expect(decodeInput(fake).ok).toBe(false);
    }
  });
});

describe("race integrity", () => {
  it("rejects a skipped checkpoint", () => {
    const car = { x: 0, y: 0, nextGate: 3, lastGate: 2, gatesPassed: 3, lap: 1, finished: false, finishTick: -1, lastGateTick: 0 } as Parameters<typeof processGates>[0];
    const gate = track.gates[6]!;
    const mid = { x: (gate.ax + gate.bx) / 2, y: (gate.ay + gate.by) / 2 };
    const px = mid.x - gate.tx;
    const py = mid.y - gate.ty;
    car.x = mid.x + gate.tx;
    car.y = mid.y + gate.ty;
    const result = processGates(car, px, py, track, 5, 100);
    expect(result.kind).toBe("skip");
    expect(car.gatesPassed).toBe(3);
    expect(car.nextGate).toBe(3);
  });

  it("does not count a lap from crossing the finish line back and forth", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    const car = sim.cars[0]!;
    const g0 = track.gates[0]!;
    const mid = { x: (g0.ax + g0.bx) / 2, y: (g0.ay + g0.by) / 2 };
    for (let i = 0; i < 6; i++) {
      // Drive forwards over the line, then reverse back over it.
      const forward = processGates(Object.assign(car, { x: mid.x + g0.tx, y: mid.y + g0.ty }), mid.x - g0.tx, mid.y - g0.ty, track, 5, i * 2);
      processGates(Object.assign(car, { x: mid.x - g0.tx, y: mid.y - g0.ty }), mid.x + g0.tx, mid.y + g0.ty, track, 5, i * 2 + 1);
      if (i === 0) expect(forward.kind).toBe("passed");
    }
    expect(car.lap).toBe(1);
    expect(car.finished).toBe(false);
    sim.dispose();
  });

  it("cannot finish by teleporting to the finish line", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    stepN(sim, 30, [BTN.ACCELERATE]);
    const car = sim.cars[0]!;
    car.lap = 5; // corrupt lap counter without having passed the gates
    const g0 = track.gates[0]!;
    car.x = (g0.ax + g0.bx) / 2 + g0.tx * 3;
    car.y = (g0.ay + g0.by) / 2 + g0.ty * 3;
    stepN(sim, 10, [BTN.ACCELERATE]);
    expect(car.finished).toBe(false);
    sim.dispose();
  });
});

describe("items and weapons", () => {
  it("rejects using an item the player does not own", async () => {
    const sim = await makeSim();
    startRace(sim);
    expect(sim.cars[0]!.item).toBe(ItemKind.None);
    expect(sim.tryUseItem(sim.cars[0]!)).toBe(false);
    const rejected = sim.drainEvents().find((e) => e.type === "item_rejected");
    expect(rejected && rejected.type === "item_rejected" && rejected.reason).toBe("no_item");
    sim.dispose();
  });

  it("an item is consumed on use and cannot be used twice", async () => {
    const sim = await makeSim();
    startRace(sim);
    const car = sim.cars[0]!;
    car.item = ItemKind.Shield;
    expect(sim.tryUseItem(car)).toBe(true);
    expect(car.item).toBe(ItemKind.None);
    expect(sim.tryUseItem(car)).toBe(false);
    sim.dispose();
  });

  it("picking up a box while holding an item does not duplicate items", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    const car = sim.cars[0]!;
    car.item = ItemKind.Mine;
    const box = sim.boxes[0]!;
    sim.placeCar(0, box.x, box.y, car.heading);
    sim.step([0]);
    const pickups = sim.drainEvents().filter((e) => e.type === "pickup");
    expect(pickups).toHaveLength(0);
    expect(car.item).toBe(ItemKind.Mine);
    expect(box.respawnTick).toBeLessThanOrEqual(sim.tick);
    sim.dispose();
  });

  it("holding USE_ITEM fires an item only once (edge-triggered)", async () => {
    const sim = await makeSim();
    startRace(sim);
    const car = sim.cars[0]!;
    car.item = ItemKind.Turbo;
    stepN(sim, 30, [BTN.USE_ITEM | BTN.ACCELERATE, 0]);
    car.item = ItemKind.Turbo; // a second item appears while still holding the button
    stepN(sim, 30, [BTN.USE_ITEM | BTN.ACCELERATE, 0]);
    const uses = sim.drainEvents().filter((e) => e.type === "item_used");
    expect(uses).toHaveLength(1);
    sim.dispose();
  });

  it("EMP without a valid target is refused and the item is kept", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    const car = sim.cars[0]!;
    car.item = ItemKind.Emp;
    expect(sim.tryUseItem(car)).toBe(false);
    expect(car.item).toBe(ItemKind.Emp);
    sim.dispose();
  });

  it("enforces weapon cooldown: 3 s cooldown never allows a shot after 0.2 s", async () => {
    const sim = await makeSim({ config: { items: { bolt: { cooldown: 3 } } } });
    startRace(sim);
    const car = sim.cars[0]!;
    expect(sim.tryFire(car)).toBe(true);
    stepN(sim, Math.round(0.2 * sim.tickRate), [0, 0]);
    expect(sim.tryFire(car)).toBe(false);
    stepN(sim, 3 * sim.tickRate, [0, 0]);
    expect(sim.tryFire(car)).toBe(true);
    sim.dispose();
  });

  it("holding FIRE cannot exceed the server fire rate or ammo", async () => {
    const sim = await makeSim();
    startRace(sim);
    const seconds = 4;
    stepN(sim, seconds * sim.tickRate, [BTN.FIRE | BTN.ACCELERATE, 0]);
    const shots = sim.drainEvents().filter((e) => e.type === "fire" && e.slot === 0);
    const maxByRate = Math.floor(seconds / DEFAULT_CONFIG.items.bolt.cooldown) + 1;
    expect(shots.length).toBeLessThanOrEqual(Math.min(maxByRate, DEFAULT_CONFIG.items.bolt.maxAmmo));
    expect(sim.cars[0]!.ammo).toBe(DEFAULT_CONFIG.items.bolt.maxAmmo - shots.length);
    sim.dispose();
  });

  it("health and damage are server-owned: a shield blocks a rocket", async () => {
    const sim = await makeSim();
    startRace(sim);
    const [a, b] = sim.cars as [typeof sim.cars[0], typeof sim.cars[0]];
    b.shieldTicks = 100;
    const pose = track.poseAt(100);
    sim.placeCar(0, pose.x, pose.y, pose.heading);
    sim.placeCar(1, pose.x + Math.cos(pose.heading) * 15, pose.y + Math.sin(pose.heading) * 15, pose.heading);
    a.progress = 10;
    b.progress = 20;
    a.item = ItemKind.Rocket;
    expect(sim.tryUseItem(a)).toBe(true);
    stepN(sim, 30, [0, 0]);
    const hit = sim.drainEvents().find((e) => e.type === "hit");
    expect(hit && hit.type === "hit" && hit.blocked).toBe(true);
    expect(b.hp).toBe(DEFAULT_CONFIG.car.maxHealth);
    sim.dispose();
  });
});

describe("suspicion scoring", () => {
  const ac = DEFAULT_CONFIG.antiCheat;

  it("one minor anomaly does not escalate", () => {
    const t = new SuspicionTracker(ac, 30);
    t.report("input_flood", 10, "x");
    expect(t.level).toBe("normal");
  });

  it("minor network noise decays over time", () => {
    const t = new SuspicionTracker(ac, 30);
    t.report("replayed_input", 1, "x");
    t.report("input_flood", 2, "x");
    for (let i = 0; i < 30 * 60; i++) t.decay(1 / 30);
    expect(t.score).toBe(0);
  });

  it("repeated impossible movement escalates fast and never decays", () => {
    const t = new SuspicionTracker(ac, 30);
    t.report("teleport", 100, "x");
    expect(t.score).toBe(20);
    expect(t.level).toBe("flagged");
    t.report("teleport", 110, "x");
    expect(t.score).toBe(70);
    expect(t.level).toBe("restricted");
    t.report("teleport", 120, "x");
    expect(t.level).toBe("match_invalidated");
    t.report("teleport", 130, "x");
    expect(t.level).toBe("temporary_suspension");
    for (let i = 0; i < 1000; i++) t.decay(1);
    expect(t.score).toBe(170);
    expect(t.needsManualReview).toBe(true);
  });
});
