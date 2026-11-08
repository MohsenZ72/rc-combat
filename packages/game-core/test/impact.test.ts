import { BTN, DEFAULT_CONFIG, ItemKind } from "@rc/shared";
import { describe, expect, it } from "vitest";
import { applyKnock, applyWallImpact, carContact, CarPredictor, integrateMovement, resolveCarImpact, type MovementState } from "../src/index.js";
import { anomalies, getRapier, makeSim, startRace, stepN, track } from "./helpers.js";

const cfg = DEFAULT_CONFIG;
const dt = 1 / cfg.net.tickRate;
type Body = MovementState & { x: number; y: number };

function body(over: Partial<Body> = {}): Body {
  return {
    x: 0, y: 0, heading: 0, vx: 0, vy: 0, yawRate: 0, speedCap: cfg.car.maxSpeed, drifting: false,
    turboTicks: 0, stunTicks: 0, empTicks: 0, wreckTicks: 0, finished: false, z: 0, vz: 0, jumpCooldownTicks: 0,
    spin: 0, tractionTicks: 0, flipTicks: 0, roll: 0, rollRate: 0, pitch: 0, pitchRate: 0,
    ...over,
  };
}

function collide(a: Body, b: Body): number {
  const c = carContact(a, b, cfg);
  expect(c).not.toBeNull();
  return resolveCarImpact(a, b, c!, cfg, dt);
}

describe("car-car impulses", () => {
  it("head-on: momentum is conserved and both cars bounce back with restitution", () => {
    const a = body({ x: 0, vx: 10 });
    const b = body({ x: 2.5, heading: Math.PI, vx: -10 });
    collide(a, b);
    expect(a.vx + b.vx).toBeCloseTo(0, 9);
    expect(a.vx).toBeCloseTo(-10 * cfg.car.carRestitution, 6);
    expect(b.vx).toBeCloseTo(10 * cfg.car.carRestitution, 6);
    // Centred hit: no spin. Both noses dive.
    expect(Math.abs(a.spin) + Math.abs(b.spin)).toBeLessThan(1e-9);
    expect(a.pitchRate).toBeLessThan(0);
    expect(b.pitchRate).toBeLessThan(0);
  });

  it("momentum is exchanged by mass: a turbo car rams harder and loses less speed", () => {
    const plainA = body({ vx: 10 });
    const plainB = body({ x: 2.5 });
    collide(plainA, plainB);
    const ramA = body({ vx: 10, turboTicks: 30 });
    const ramB = body({ x: 2.5 });
    collide(ramA, ramB);
    const m = cfg.impact.mass;
    const mRam = m * cfg.impact.turboMassMultiplier;
    expect(mRam * ramA.vx + m * ramB.vx).toBeCloseTo(mRam * 10, 9);
    expect(ramA.vx).toBeGreaterThan(plainA.vx);
    expect(ramB.vx).toBeGreaterThan(plainB.vx);
  });

  it("an off-centre hit on the rear quarter spins the car; a centred one does not", () => {
    // B points along +x; A drives up (+y) into B's rear quarter (x < 0 is B's rear).
    const victim = body();
    const rammer = body({ x: -0.55, y: -1.45, heading: Math.PI / 2, vy: 15 });
    collide(rammer, victim);
    expect(victim.vy).toBeGreaterThan(5);
    // Rear pushed to the left → nose swings right (clockwise, negative yaw).
    expect(victim.spin).toBeLessThan(-2);
    expect(victim.tractionTicks).toBeGreaterThan(0);
    // Pushed towards its left: the roof rolls left.
    expect(victim.rollRate).toBeGreaterThan(0);

    const centred = body();
    collide(body({ x: 0, y: -1.45, heading: Math.PI / 2, vy: 15 }), centred);
    expect(Math.abs(centred.spin)).toBeLessThan(1e-9);
  });

  it("a gentle nudge neither bounces nor unsettles the tyres", () => {
    const a = body({ vx: 1.5 });
    const b = body({ x: 2.5 });
    collide(a, b);
    expect(a.tractionTicks).toBe(0);
    expect(b.tractionTicks).toBe(0);
    expect(a.vx).toBeCloseTo(b.vx, 6); // perfectly plastic: they move off together
  });

  it("spin never exceeds the ceiling, even from a full-speed hit", () => {
    const victim = body();
    collide(body({ x: -0.55, y: -1.45, heading: Math.PI / 2, vy: 39, turboTicks: 30 }), victim);
    expect(Math.abs(victim.spin)).toBeLessThanOrEqual(cfg.impact.maxSpin);
    expect(Math.hypot(victim.vx, victim.vy)).toBeLessThanOrEqual(cfg.car.maxSpeed * cfg.items.turbo.speedMultiplier * 1.35 + 1e-9);
  });
});

describe("wall impacts", () => {
  it("bounces back from a head-on wall hit instead of stopping dead", () => {
    const car = body({ vx: 20 });
    applyWallImpact(car, -1, 0, cfg, dt);
    expect(car.vx).toBeCloseTo(-20 * cfg.car.wallRestitution, 6);
    expect(Math.abs(car.spin)).toBeLessThan(1e-9);
    expect(car.pitchRate).toBeLessThan(0); // nose dives into the wall
  });

  it("a glancing hit keeps most of the speed and turns the nose away from the wall", () => {
    const h = 0.3; // heading into a wall on the car's left (+y), wall normal points -y
    const car = body({ heading: h, vx: Math.cos(h) * 25, vy: Math.sin(h) * 25 });
    applyWallImpact(car, 0, -1, cfg, dt);
    expect(car.vy).toBeLessThan(0); // moving away from the wall
    expect(Math.hypot(car.vx, car.vy)).toBeGreaterThan(25 * 0.82); // the old model kept ≤ 82%
    expect(car.spin).toBeLessThan(-0.5); // clockwise: away from a wall on the left
  });

  it("slow contact scrapes along the wall without bouncing", () => {
    const car = body({ heading: 0.05, vx: 10, vy: 1 });
    applyWallImpact(car, 0, -1, cfg, dt);
    // The contact point stops; the centre keeps a little of it as the car pivots off the wall. No bounce.
    expect(car.vy).toBeLessThan(0.3);
    expect(car.vy).toBeGreaterThan(-0.3);
    expect(car.vx).toBeGreaterThan(9.5);
    expect(car.tractionTicks).toBe(0);
  });
});

describe("after the hit", () => {
  it("traction loss lets the car slide sideways, then grip comes back", () => {
    const run = (c: Body, ticks: number) => {
      for (let i = 0; i < ticks; i++) integrateMovement(c, BTN.ACCELERATE, dt, cfg, BTN.ACCELERATE);
    };
    const hit = body({ vx: 20, vy: 8 });
    applyKnock(hit, 0, 8, 0, cfg, dt);
    expect(hit.tractionTicks).toBeGreaterThan(0);
    const clean = body({ vx: 20, vy: 8 });
    run(hit, 6);
    run(clean, 6);
    expect(Math.abs(hit.vy)).toBeGreaterThan(Math.abs(clean.vy) * 2);
    run(hit, 60);
    expect(hit.tractionTicks).toBe(0);
    expect(Math.abs(hit.vy)).toBeLessThan(0.05);
  });

  it("a side hit tips the body, which wobbles back to level", () => {
    const car = body({ vx: 15 });
    applyKnock(car, 0, 8, 0, cfg, dt);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      integrateMovement(car, BTN.ACCELERATE, dt, cfg, BTN.ACCELERATE);
      peak = Math.max(peak, car.roll);
    }
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThan(1);
    expect(Math.abs(car.roll)).toBeLessThan(0.01);
    expect(car.flipTicks).toBe(0);
  });

  it("a very hard side hit rolls the car over and it lands upright", () => {
    const car = body({ vx: 15 });
    applyKnock(car, 0, cfg.impact.flipImpulse + 1, 0, cfg, dt);
    const ticks = Math.round(cfg.impact.flipSeconds / dt);
    expect(car.flipTicks).toBe(ticks);
    expect(car.vz).toBeGreaterThan(0);
    expect(car.vz).toBeLessThanOrEqual(cfg.car.jumpVelocity);
    let maxRoll = 0;
    let maxSpeed = 0;
    for (let i = 0; i < ticks; i++) {
      integrateMovement(car, BTN.ACCELERATE, dt, cfg, BTN.ACCELERATE);
      maxRoll = Math.max(maxRoll, Math.abs(car.roll));
      maxSpeed = Math.max(maxSpeed, Math.hypot(car.vx, car.vy));
    }
    expect(maxRoll).toBeGreaterThan(3); // went through upside down
    expect(maxSpeed).toBeLessThanOrEqual(Math.hypot(15, cfg.impact.flipImpulse + 1)); // no throttle while rolling
    expect(car.flipTicks).toBe(0);
    expect(car.roll).toBe(0);
    expect(car.z).toBe(0);
    // Back on its wheels: throttle works again.
    const before = car.vx;
    integrateMovement(car, BTN.ACCELERATE, dt, cfg, BTN.ACCELERATE);
    expect(car.vx).toBeGreaterThan(before);
  });
});

describe("collisions in the live simulation", () => {
  it("a full-speed T-bone flips and spins the victim, with zero anti-cheat anomalies", async () => {
    const sim = await makeSim();
    startRace(sim);
    const s0 = 40;
    const pose = track.poseAt(s0);
    const target = track.poseAt(s0 + 40);
    sim.placeCar(0, pose.x, pose.y, pose.heading);
    // Across the track, shifted so the rammer hits its rear quarter.
    const across = target.heading + Math.PI / 2;
    sim.placeCar(1, target.x - Math.cos(across) * 0.6, target.y - Math.sin(across) * 0.6, across);
    const b = sim.cars[1]!;
    let hit = false;
    let flipped = false;
    let maxSpin = 0;
    let maxRoll = 0;
    const flagged = [];
    for (let i = 0; i < 150; i++) {
      sim.step([BTN.ACCELERATE, 0]);
      const events = sim.drainEvents();
      hit ||= events.some((e) => e.type === "collision" && e.other !== "wall");
      // Placing cars mid-lap skips gates; only movement checks matter here.
      flagged.push(...events.filter((e) => e.type === "anomaly" && e.kind !== "checkpoint_skip"));
      flipped ||= b.flipTicks > 0;
      maxSpin = Math.max(maxSpin, Math.abs(b.spin));
      maxRoll = Math.max(maxRoll, Math.abs(b.roll));
    }
    expect(hit).toBe(true);
    expect(flipped).toBe(true);
    expect(maxSpin).toBeGreaterThan(2);
    expect(maxRoll).toBeGreaterThan(3);
    expect(flagged).toEqual([]);
    // Landed upright again.
    expect(b.flipTicks).toBe(0);
    expect(b.roll).toBe(0);
    expect(b.z).toBe(0);
    sim.dispose();
  });

  it("a rocket hit rolls the target over", async () => {
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
    let flipped = false;
    for (let i = 0; i < 30; i++) {
      sim.step([0, 0]);
      flipped ||= b.flipTicks > 0;
    }
    expect(b.hp).toBe(100 - sim.config.items.rocket.damage);
    expect(flipped).toBe(true);
    expect(anomalies(sim)).toEqual([]);
    sim.dispose();
  });

  it("client prediction matches the server through wall bounces", async () => {
    const R = await getRapier();
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    const predictor = new CarPredictor(R, track, sim.config, 0);
    predictor.reconcile(sim.snapshot(0).cars[0]!, 0, true);
    let wallHits = 0;
    for (let seq = 1; seq <= 120; seq++) {
      // Full throttle while steering hard right after a second: it runs into the outside wall.
      const buttons = BTN.ACCELERATE | (seq > 30 ? BTN.STEER_RIGHT : 0);
      predictor.applyInput(seq, buttons, true);
      sim.step([buttons]);
      wallHits += sim.drainEvents().filter((e) => e.type === "collision" && e.other === "wall").length;
    }
    expect(wallHits).toBeGreaterThan(0);
    const server = sim.cars[0]!;
    expect(Math.hypot(predictor.state.x - server.x, predictor.state.y - server.y)).toBeLessThan(0.05);
    expect(Math.abs(predictor.state.spin - server.spin)).toBeLessThan(1e-3);
    predictor.dispose();
    sim.dispose();
  });
});

describe("snapshot", () => {
  it("carries the impact state", async () => {
    const { decodeSnapshot, encodeSnapshot } = await import("@rc/shared");
    const sim = await makeSim();
    startRace(sim);
    const car = sim.cars[0]!;
    Object.assign(car, { spin: -3.25, roll: 1.2, rollRate: 6.5, pitch: -0.3, pitchRate: -4, tractionTicks: 12, flipTicks: 9 });
    const decoded = decodeSnapshot(encodeSnapshot(sim.snapshot(0)));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const c = decoded.value.cars[0]!;
    expect(c.spin).toBeCloseTo(-3.25, 3);
    expect(c.roll).toBeCloseTo(1.2, 1);
    expect(c.rollRate).toBeCloseTo(6.5, 1);
    expect(c.pitch).toBeCloseTo(-0.3, 1);
    expect(c.pitchRate).toBeCloseTo(-4, 1);
    expect(c.tractionTicks).toBe(12);
    expect(c.flipTicks).toBe(9);
    sim.dispose();
  });
});
