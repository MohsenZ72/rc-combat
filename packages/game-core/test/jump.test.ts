import { BTN, DEFAULT_CONFIG, ItemKind } from "@rc/shared";
import { describe, expect, it } from "vitest";
import { maxJumpHeight, validateMovement } from "../src/index.js";
import { makeSim, startRace, stepN, track } from "./helpers.js";

const J = BTN.JUMP;

describe("jump", () => {
  it("every car can jump by default and lands again", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    stepN(sim, 20, [BTN.ACCELERATE]);
    sim.step([BTN.ACCELERATE | J]);
    const car = sim.cars[0]!;
    expect(sim.drainEvents().some((e) => e.type === "jump")).toBe(true);
    let apex = 0;
    for (let i = 0; i < 40; i++) {
      sim.step([BTN.ACCELERATE | J]);
      apex = Math.max(apex, car.z);
    }
    expect(apex).toBeGreaterThan(1);
    expect(apex).toBeLessThanOrEqual(maxJumpHeight(DEFAULT_CONFIG) + 1e-9);
    expect(car.z).toBe(0);
    sim.dispose();
  });

  it("holding jump does not bunny-hop and there is no double jump", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    stepN(sim, 6 * sim.tickRate, [BTN.ACCELERATE | J]);
    const jumps = sim.drainEvents().filter((e) => e.type === "jump");
    expect(jumps).toHaveLength(1);
    sim.dispose();
  });

  it("pressing jump again in the air or during cooldown does nothing", async () => {
    const sim = await makeSim({ slots: 1 });
    startRace(sim);
    const tap = (n: number) => {
      for (let i = 0; i < n; i++) sim.step([i % 2 === 0 ? J : 0]);
    };
    tap(30); // ~1 s of tapping: one take-off, the rest in the air or on cooldown
    expect(sim.drainEvents().filter((e) => e.type === "jump")).toHaveLength(1);
    stepN(sim, sim.tickRate, [0]);
    tap(2);
    expect(sim.drainEvents().filter((e) => e.type === "jump")).toHaveLength(1);
    sim.dispose();
  });

  it("a jump dodges a bolt", async () => {
    const sim = await makeSim();
    startRace(sim);
    const pose = track.poseAt(150);
    sim.placeCar(0, pose.x, pose.y, pose.heading);
    sim.placeCar(1, pose.x + Math.cos(pose.heading) * 10, pose.y + Math.sin(pose.heading) * 10, pose.heading);
    sim.step([0, J]);
    stepN(sim, 4, [0, 0]);
    expect(sim.cars[1]!.z).toBeGreaterThan(0.6);
    sim.tryFire(sim.cars[0]!);
    stepN(sim, 6, [0, 0]);
    expect(sim.drainEvents().some((e) => e.type === "hit")).toBe(false);
    expect(sim.cars[1]!.hp).toBe(DEFAULT_CONFIG.car.maxHealth);
    sim.dispose();
  });

  it("a car in the air does not set off a mine", async () => {
    const sim = await makeSim({ slots: 2 });
    startRace(sim);
    const pose = track.poseAt(150);
    sim.placeCar(0, pose.x, pose.y, pose.heading);
    sim.cars[0]!.item = ItemKind.Mine;
    sim.tryUseItem(sim.cars[0]!);
    stepN(sim, 30, [0, 0]);
    const mine = sim.activeProjectiles()[0]!;
    sim.placeCar(1, mine.x - Math.cos(pose.heading) * 6, mine.y - Math.sin(pose.heading) * 6, pose.heading);
    sim.cars[1]!.vx = Math.cos(pose.heading) * 18;
    sim.cars[1]!.vy = Math.sin(pose.heading) * 18;
    sim.step([0, BTN.ACCELERATE | J]);
    stepN(sim, 12, [0, BTN.ACCELERATE]);
    expect(sim.drainEvents().some((e) => e.type === "hit" && e.source === "mine")).toBe(false);
    sim.dispose();
  });

  it("validator rejects flying and mid-air lift", () => {
    const base = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
    const ctx = { dt: 1 / 30, config: DEFAULT_CONFIG, track, turbo: false, impulse: false, respawned: false, prevSpeedCap: 30 };
    const p0 = track.poseAt(200);
    const at = { ...base, x: p0.x, y: p0.y, heading: p0.heading };
    const fly = validateMovement({ ...at, z: 1, vz: 0 }, { ...at, z: 5, vz: 0 }, ctx);
    expect(fly.violations.map((v) => v.kind)).toContain("jump");
    expect(fly.corrected!.z).toBeLessThanOrEqual(maxJumpHeight(DEFAULT_CONFIG) * 1.1 + 0.05);
    const lift = validateMovement({ ...at, z: 1, vz: -2 }, { ...at, z: 1.05, vz: 3 }, ctx);
    expect(lift.violations.map((v) => v.kind)).toContain("jump");
    const legit = validateMovement({ ...at, z: 0, vz: 0 }, { ...at, z: 0.24, vz: 6.77 }, ctx);
    expect(legit.violations).toEqual([]);
  });
});
