import { DEFAULT_CONFIG, mergeConfig, Phase, type DeepPartial, type GameConfig } from "@rc/shared";
import { loadRapier, RaceSimulation, Track, WORKSHOP_CIRCUIT, type Rapier } from "../src/index.js";

export { Phase };

let rapier: Rapier | null = null;
export async function getRapier(): Promise<Rapier> {
  rapier ??= await loadRapier();
  return rapier;
}

export const track = new Track(WORKSHOP_CIRCUIT);

export async function makeSim(opts: { slots?: number; seed?: number; config?: DeepPartial<GameConfig> } = {}): Promise<RaceSimulation> {
  const config = opts.config ? mergeConfig(DEFAULT_CONFIG, opts.config) : DEFAULT_CONFIG;
  return new RaceSimulation({ rapier: await getRapier(), track, config, seed: opts.seed ?? 42, slots: opts.slots ?? 2 });
}

/** Steps through the countdown so the race is live. */
export function startRace(sim: RaceSimulation): void {
  const zero = new Array(sim.cars.length).fill(0);
  while (sim.phase !== Phase.Racing) sim.step(zero);
  sim.drainEvents();
}

export function stepN(sim: RaceSimulation, n: number, inputs: number[] | ((tick: number) => number[])): void {
  for (let i = 0; i < n; i++) sim.step(typeof inputs === "function" ? inputs(sim.tick) : inputs);
}

export function anomalies(sim: RaceSimulation) {
  return sim.drainEvents().filter((e) => e.type === "anomaly");
}
