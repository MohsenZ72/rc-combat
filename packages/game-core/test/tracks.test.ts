import { BTN, DEFAULT_CONFIG } from "@rc/shared";
import { describe, expect, it } from "vitest";
import { BotDriver, configForTrack, RaceSimulation, Track, TRACK_IDS, TRACKS } from "../src/index.js";
import { getRapier } from "./helpers.js";

describe.each(TRACK_IDS)("track %s", (id) => {
  const def = TRACKS[id]!;
  const track = new Track(def);

  it("has safe geometry (no self-intersecting walls, sane grades)", () => {
    expect(track.minCurvatureRadius()).toBeGreaterThan(track.halfWidth * 1.5);
    let minClear = Infinity;
    for (let i = 0; i < track.count; i += 2) {
      for (let j = i + 1; j < track.count; j += 2) {
        const along = Math.abs(track.cumulative[i]! - track.cumulative[j]!);
        if (Math.min(along, track.length - along) < 60) continue;
        minClear = Math.min(minClear, Math.hypot(track.xs[i]! - track.xs[j]!, track.ys[i]! - track.ys[j]!));
      }
    }
    expect(minClear).toBeGreaterThan(def.width * 3);
    const e = track.elevationStats();
    expect(e.min).toBeGreaterThanOrEqual(0);
    expect(e.maxSlope).toBeLessThanOrEqual(0.25);
  });

  it("places the grid and item boxes on the racing surface", () => {
    for (let slot = 0; slot < 10; slot++) {
      const p = track.gridPose(slot);
      expect(Math.abs(track.project(p.x, p.y).lateral)).toBeLessThan(track.halfWidth - 1.5);
    }
    for (const b of track.boxes) expect(Math.abs(track.project(b.x, b.y).lateral)).toBeLessThan(track.halfWidth);
  });

  it("10 bots race 90 s with zero anti-cheat anomalies", async () => {
    const config = configForTrack(DEFAULT_CONFIG, def);
    const sim = new RaceSimulation({ rapier: await getRapier(), track, config, seed: 21, slots: 10 });
    const bots = Array.from({ length: 10 }, (_, i) => new BotDriver(i, 21, 0.5 + (i % 4) * 0.1));
    const inputs = new Array(10).fill(0);
    const anomalies: unknown[] = [];
    for (let t = 0; t < 30 * 94; t++) {
      for (const b of bots) inputs[b.slot] = b.decide({ track, cars: sim.cars, tickRate: sim.tickRate, projectiles: sim.activeProjectiles() });
      sim.step(inputs);
      anomalies.push(...sim.drainEvents().filter((e) => e.type === "anomaly"));
    }
    expect(anomalies).toEqual([]);
    expect(Math.max(...sim.cars.map((c) => c.lap))).toBeGreaterThanOrEqual(2);
    sim.dispose();
  });
});

describe("terrain", () => {
  it("a ramp launches a fast car but not a slow one", async () => {
    const def = TRACKS["kitchen-tiles"]!;
    const track = new Track(def);
    const ramp = track.rampS[0]!;
    const launch = async (driveTicks: number) => {
      const sim = new RaceSimulation({ rapier: await getRapier(), track, config: DEFAULT_CONFIG, seed: 1, slots: 1 });
      const zero = [0];
      while (sim.phase !== 2) sim.step(zero);
      const start = track.poseAt(ramp - 80);
      sim.placeCar(0, start.x, start.y, start.heading);
      let jumped = false;
      for (let i = 0; i < 200 && !jumped; i++) {
        const before = sim.cars[0]!.trackS;
        sim.step([i < driveTicks ? BTN.ACCELERATE : 0]);
        jumped = sim.drainEvents().some((e) => e.type === "jump");
        if (sim.cars[0]!.trackS > ramp + 20 && before > ramp + 20) break;
      }
      sim.dispose();
      return jumped;
    };
    expect(await launch(200)).toBe(true);
    expect(await launch(8)).toBe(false);
  });

  it("water and hills exist where the track says", () => {
    const kitchen = new Track(TRACKS["kitchen-tiles"]!);
    expect(kitchen.waterAt(kitchen.waterRanges[0]!.from + 1)).toBe(true);
    expect(kitchen.waterAt(0)).toBe(false);
    const canyon = new Track(TRACKS["toy-track-canyon"]!);
    expect(canyon.elevationStats().max).toBeGreaterThan(10);
  });
});
