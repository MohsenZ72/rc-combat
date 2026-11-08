import { BTN, decodeSnapshot, encodeSnapshot, ItemKind, Phase } from "@rc/shared";
import { describe, expect, it } from "vitest";
import { BotDriver, CarPredictor, ReplayRecorder, verifyReplay, WORKSHOP_CIRCUIT } from "../src/index.js";
import { getRapier, makeSim, startRace, stepN, track } from "./helpers.js";

describe("track", () => {
  it("is a valid closed loop", () => {
    expect(track.length).toBeGreaterThan(900);
    expect(track.minCurvatureRadius()).toBeGreaterThan(track.halfWidth * 1.5);
    expect(track.gates).toHaveLength(WORKSHOP_CIRCUIT.checkpointCount);
  });

  it("places every grid slot and item box on the track", () => {
    for (let slot = 0; slot < 10; slot++) {
      const p = track.gridPose(slot);
      expect(Math.abs(track.project(p.x, p.y).lateral)).toBeLessThan(track.halfWidth - 1.5);
    }
    for (const b of track.boxes) expect(Math.abs(track.project(b.x, b.y).lateral)).toBeLessThan(track.halfWidth);
  });
});

describe("simulation", () => {
  it("cars cannot move during the countdown", async () => {
    const sim = await makeSim();
    const start = { x: sim.cars[0]!.x, y: sim.cars[0]!.y };
    stepN(sim, sim.raceStartTick - 1, [BTN.ACCELERATE, BTN.ACCELERATE]);
    expect(sim.phase).toBe(Phase.Countdown);
    expect(sim.cars[0]!.x).toBe(start.x);
    expect(sim.cars[0]!.y).toBe(start.y);
    sim.dispose();
  });

  it("walls stop a car driving straight at full speed", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    stepN(sim, 30 * 20, [BTN.ACCELERATE]);
    const car = sim.cars[0]!;
    expect(Math.abs(track.project(car.x, car.y).lateral)).toBeLessThanOrEqual(track.halfWidth);
    sim.dispose();
  });

  it("disconnected cars receive neutral input", async () => {
    const sim = await makeSim();
    startRace(sim);
    sim.setDisconnected(1, true);
    stepN(sim, 60, [BTN.ACCELERATE, BTN.ACCELERATE]);
    expect(sim.cars[0]!.progress).toBeGreaterThan(10);
    expect(Math.abs(sim.cars[1]!.vx) + Math.abs(sim.cars[1]!.vy)).toBe(0);
    sim.dispose();
  });

  it("forfeited players rank last", async () => {
    const sim = await makeSim({ slots: 3 });
    startRace(sim);
    stepN(sim, 30, [BTN.ACCELERATE, BTN.ACCELERATE, BTN.ACCELERATE]);
    sim.forfeit(0, "left");
    stepN(sim, 1, [0, 0, 0]);
    expect(sim.cars[0]!.rank).toBe(3);
    expect(sim.results().at(-1)!.status).toBe("forfeit");
    sim.dispose();
  });

  it("rockets damage an unshielded target", async () => {
    const sim = await makeSim();
    startRace(sim);
    const [a, b] = sim.cars as [typeof sim.cars[0], typeof sim.cars[0]];
    const pose = track.poseAt(100);
    sim.placeCar(0, pose.x, pose.y, pose.heading);
    sim.placeCar(1, pose.x + Math.cos(pose.heading) * 15, pose.y + Math.sin(pose.heading) * 15, pose.heading);
    a.progress = 10;
    b.progress = 20;
    a.item = ItemKind.Rocket;
    sim.tryUseItem(a);
    stepN(sim, 30, [0, 0]);
    expect(b.hp).toBe(100 - sim.config.items.rocket.damage);
    sim.dispose();
  });
});

describe("protocol", () => {
  it("round-trips snapshots", async () => {
    const sim = await makeSim({ slots: 4 });
    startRace(sim);
    stepN(sim, 40, [BTN.ACCELERATE | BTN.FIRE, BTN.ACCELERATE, 0, BTN.ACCELERATE]);
    const snap = sim.snapshot(1234);
    const decoded = decodeSnapshot(encodeSnapshot(snap));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.ack).toBe(1234);
    expect(decoded.value.cars).toHaveLength(4);
    expect(decoded.value.cars[0]!.x).toBeCloseTo(snap.cars[0]!.x, 3);
    expect(decoded.value.projectiles.length).toBe(snap.projectiles.length);
    expect(decoded.value.boxes).toEqual(snap.boxes);
    sim.dispose();
  });
});

describe("replay", () => {
  it("re-simulates a recorded match exactly", async () => {
    const R = await getRapier();
    const sim = await makeSim({ slots: 4, seed: 77 });
    const bots = [0, 1, 2, 3].map((i) => new BotDriver(i, 77));
    const rec = new ReplayRecorder({ matchId: "t", trackId: track.def.id, seed: 77, config: sim.config, slots: 4, players: [], startedAt: new Date(0).toISOString() });
    const inputs = [0, 0, 0, 0];
    for (let t = 0; t < 1500; t++) {
      if (t === 700) {
        rec.recordControl({ tick: sim.tick + 1, type: "forfeit", slot: 2, reason: "left" });
        sim.forfeit(2, "left");
      }
      for (const b of bots) inputs[b.slot] = b.decide({ track, cars: sim.cars, tickRate: sim.tickRate });
      rec.recordInputs(sim.tick + 1, inputs);
      sim.step(inputs);
      rec.afterStep(sim, sim.drainEvents());
    }
    const replay = JSON.parse(JSON.stringify(rec.finish(sim)));
    const v = verifyReplay(R, replay, WORKSHOP_CIRCUIT);
    expect(v.firstMismatch).toBeNull();
    expect(v.keyframesChecked).toBeGreaterThan(100);
    expect(v.ok).toBe(true);
    sim.dispose();
  });

  it("detects a tampered replay", async () => {
    const R = await getRapier();
    const sim = await makeSim({ slots: 2, seed: 5 });
    const rec = new ReplayRecorder({ matchId: "t", trackId: track.def.id, seed: 5, config: sim.config, slots: 2, players: [], startedAt: new Date(0).toISOString() });
    for (let t = 0; t < 400; t++) {
      const inputs = [BTN.ACCELERATE, BTN.ACCELERATE | (t % 40 < 20 ? BTN.STEER_LEFT : 0)];
      rec.recordInputs(sim.tick + 1, inputs);
      sim.step(inputs);
      rec.afterStep(sim, sim.drainEvents());
    }
    const replay = rec.finish(sim);
    replay.keyframes[replay.keyframes.length - 6] = replay.keyframes.at(-6)! + 25; // move slot 1 final x
    expect(verifyReplay(R, replay, WORKSHOP_CIRCUIT).ok).toBe(false);
    sim.dispose();
  });
});

describe("client prediction", () => {
  it("matches the server when inputs line up", async () => {
    const R = await getRapier();
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    const predictor = new CarPredictor(R, track, sim.config, 0);
    predictor.reconcile(sim.snapshot(0).cars[0]!, 0, true);
    for (let seq = 1; seq <= 90; seq++) {
      const buttons = BTN.ACCELERATE | (seq > 40 && seq < 60 ? BTN.STEER_LEFT : 0);
      predictor.applyInput(seq, buttons, true);
      sim.step([buttons]);
    }
    const server = sim.cars[0]!;
    expect(Math.hypot(predictor.state.x - server.x, predictor.state.y - server.y)).toBeLessThan(0.05);
    predictor.reconcile(sim.snapshot(90).cars[0]!, 90, true);
    expect(predictor.lastCorrection).toBeLessThan(0.05);
    predictor.dispose();
    sim.dispose();
  });
});
