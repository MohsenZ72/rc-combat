import { BTN, DEFAULT_CONFIG } from "@rc/shared";
import { describe, expect, it } from "vitest";
import { integrateMovement, type MovementState } from "../src/index.js";
import { makeSim, startRace, stepN, track } from "./helpers.js";

const dt = 1 / 30;
function car(speed: number): MovementState {
  return {
    heading: 0, vx: speed, vy: 0, yawRate: 0, speedCap: DEFAULT_CONFIG.car.maxSpeed, drifting: false,
    turboTicks: 0, stunTicks: 0, empTicks: 0, wreckTicks: 0, finished: false, z: 0, vz: 0, jumpCooldownTicks: 0,
  };
}
const run = (c: MovementState, buttons: number, ticks: number, surface = { slope: 0, water: false }) => {
  for (let i = 0; i < ticks; i++) integrateMovement(c, buttons, dt, DEFAULT_CONFIG, buttons, surface);
};

describe("handbrake", () => {
  it("slows far less than the brake and never reverses", () => {
    const hb = car(25);
    const br = car(25);
    run(hb, BTN.HANDBRAKE, 15);
    run(br, BTN.BRAKE, 15);
    expect(Math.hypot(hb.vx, hb.vy)).toBeGreaterThan(Math.hypot(br.vx, br.vy) + 5);
    run(hb, BTN.HANDBRAKE, 200);
    expect(hb.vx * Math.cos(hb.heading) + hb.vy * Math.sin(hb.heading)).toBeGreaterThanOrEqual(0);
  });

  it("handbrake + steer makes the car slide sideways (drift)", () => {
    const grip = car(24);
    const slide = car(24);
    run(grip, BTN.ACCELERATE | BTN.STEER_LEFT, 10);
    run(slide, BTN.HANDBRAKE | BTN.STEER_LEFT, 10);
    const lateral = (c: MovementState) => Math.abs(c.vx * -Math.sin(c.heading) + c.vy * Math.cos(c.heading));
    expect(slide.drifting).toBe(true);
    expect(lateral(slide)).toBeGreaterThan(lateral(grip) * 2);
  });

  it("throttle + steer after the handbrake holds the drift", () => {
    const c = car(24);
    run(c, BTN.HANDBRAKE | BTN.STEER_LEFT, 12);
    run(c, BTN.ACCELERATE | BTN.STEER_LEFT, 5);
    expect(c.drifting).toBe(true);
  });
});

describe("surfaces", () => {
  it("uphill slows, downhill speeds up but never past the cap", () => {
    const up = car(20);
    const down = car(20);
    run(up, 0, 30, { slope: 0.2, water: false });
    run(down, 0, 30, { slope: -0.2, water: false });
    expect(Math.hypot(up.vx, up.vy)).toBeLessThan(Math.hypot(down.vx, down.vy));
    const fast = car(29.9);
    run(fast, BTN.ACCELERATE, 120, { slope: -0.3, water: false });
    expect(Math.hypot(fast.vx, fast.vy)).toBeLessThanOrEqual(DEFAULT_CONFIG.car.maxSpeed + 1e-9);
  });

  it("water lowers top speed", () => {
    const c = car(0);
    run(c, BTN.ACCELERATE, 200, { slope: 0, water: true });
    expect(Math.hypot(c.vx, c.vy)).toBeLessThanOrEqual(DEFAULT_CONFIG.car.maxSpeed * DEFAULT_CONFIG.car.waterSpeedMultiplier + 1e-6);
  });
});

describe("jump over a car", () => {
  it("a car can jump clean over another car without colliding", async () => {
    const sim = await makeSim();
    startRace(sim);
    const pose = track.poseAt(40);
    const fx = Math.cos(pose.heading);
    const fy = Math.sin(pose.heading);
    sim.placeCar(0, pose.x, pose.y, pose.heading);
    sim.placeCar(1, pose.x + fx * 70, pose.y + fy * 70, pose.heading);
    const gap = () => (sim.cars[1]!.x - sim.cars[0]!.x) * fx + (sim.cars[1]!.y - sim.cars[0]!.y) * fy;
    // Build up speed by driving (the validator would flag a hand-set velocity), take off ~10 m short.
    for (let i = 0; i < 200 && gap() > 10; i++) sim.step([BTN.ACCELERATE, 0]);
    sim.drainEvents();
    sim.step([BTN.ACCELERATE | BTN.JUMP, 0]);
    let collided = false;
    for (let i = 0; i < 26; i++) {
      sim.step([BTN.ACCELERATE, 0]);
      collided ||= sim.drainEvents().some((e) => e.type === "collision" && e.other !== "wall");
    }
    const a = sim.cars[0]!;
    const b = sim.cars[1]!;
    expect(collided).toBe(false);
    expect((a.x - b.x) * fx + (a.y - b.y) * fy).toBeGreaterThan(2); // landed ahead of the other car
    sim.dispose();
  });
});
