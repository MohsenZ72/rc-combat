/**
 * Runs a full 10-bot race headless and prints lap times, results, anomaly
 * counts and tick cost. Used to tune balance and to catch anti-cheat false
 * positives: a race between honest bots must produce zero movement anomalies.
 *
 *   npx tsx --conditions=source scripts/headless-race.ts [seed]
 */
import { DEFAULT_CONFIG, ITEM_NAMES } from "@rc/shared";
import { BotDriver, loadRapier, RaceSimulation, ReplayRecorder, Track, verifyReplay, WORKSHOP_CIRCUIT } from "../src/index.js";

const seed = Number(process.argv[2] ?? 1234);
const R = await loadRapier();
const track = new Track(WORKSHOP_CIRCUIT);
const config = DEFAULT_CONFIG;
const sim = new RaceSimulation({ rapier: R, track, config, seed, slots: 10 });
const bots = Array.from({ length: 10 }, (_, i) => new BotDriver(i, seed, 0.45 + (i % 5) * 0.12));
const recorder = new ReplayRecorder({ matchId: "headless", trackId: track.def.id, seed, config, slots: 10, players: [], startedAt: new Date().toISOString() });
const inputs = new Array<number>(10).fill(0);
const counts: Record<string, number> = {};
const anomalies: string[] = [];
let worst = 0;
const t0 = performance.now();
while (sim.phase !== 3 && sim.tick < 40000) {
  for (const b of bots) inputs[b.slot] = b.decide({ track, cars: sim.cars, tickRate: sim.tickRate, projectiles: sim.activeProjectiles() });
  recorder.recordInputs(sim.tick + 1, inputs);
  const s = performance.now();
  sim.step(inputs);
  worst = Math.max(worst, performance.now() - s);
  const events = sim.drainEvents();
  recorder.afterStep(sim, events);
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (e.type === "anomaly") anomalies.push(`t${e.tick} slot${e.slot} ${e.kind} ${e.detail}`);
    if (e.type === "lap" && e.slot === 0) console.log(`slot0 lap ${e.lap} ${(e.lapTicks / sim.tickRate).toFixed(1)}s`);
    if (e.type === "pickup" && counts.pickup! <= 3) console.log(`pickup ${ITEM_NAMES[e.item]}`);
  }
}
const elapsed = performance.now() - t0;
console.log(`ticks ${sim.tick} (${(sim.raceTick / sim.tickRate).toFixed(1)}s race) end=${sim.endReason} avg ${(elapsed / sim.tick).toFixed(3)}ms/tick worst ${worst.toFixed(2)}ms`);
console.log("events", counts);
for (const r of sim.results()) console.log(r.rank, `slot${r.slot}`, r.status, r.finishTicks ? (r.finishTicks / sim.tickRate).toFixed(1) + "s" : "-", r.lapsCompleted, r.progress.toFixed(0));
console.log("anomalies", anomalies.length, anomalies.slice(0, 15));
const replay = recorder.finish(sim);
const json = JSON.stringify(replay);
console.log("replay bytes", json.length);
console.log("verify", verifyReplay(R, JSON.parse(json), WORKSHOP_CIRCUIT));
