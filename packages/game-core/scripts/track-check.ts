/**
 * Prints geometry sanity numbers for a track: lap length, minimum curvature
 * radius vs half-width, clearance between distant parts of the loop, and
 * grid slot offsets.
 *
 *   npx tsx --conditions=source packages/game-core/scripts/track-check.ts [trackId]
 */
import { Track, TRACKS, WORKSHOP_CIRCUIT } from "../src/index.js";

const def = TRACKS[process.argv[2] ?? WORKSHOP_CIRCUIT.id];
if (!def) {
  console.error(`unknown track; known: ${Object.keys(TRACKS).join(", ")}`);
  process.exit(1);
}
const t = new Track(def);
let minClear = Infinity;
for (let i = 0; i < t.count; i++) {
  for (let j = i + 1; j < t.count; j++) {
    const along = Math.abs(t.cumulative[i]! - t.cumulative[j]!);
    if (Math.min(along, t.length - along) < 60) continue;
    minClear = Math.min(minClear, Math.hypot(t.xs[i]! - t.xs[j]!, t.ys[i]! - t.ys[j]!));
  }
}
const minR = t.minCurvatureRadius();
console.log(`${def.name}: length ${t.length.toFixed(1)} m, ${t.count} samples, ${t.gates.length} gates, ${t.boxes.length} item boxes`);
console.log(`min curvature radius ${minR.toFixed(1)} m (needs > ${(t.halfWidth * 1.5).toFixed(1)}) ${minR > t.halfWidth * 1.5 ? "OK" : "FAIL"}`);
console.log(`min clearance between distant parts ${minClear.toFixed(1)} m (needs > ${(def.width * 3).toFixed(1)}) ${minClear > def.width * 3 ? "OK" : "FAIL"}`);
for (let slot = 0; slot < 10; slot++) {
  const p = t.gridPose(slot);
  console.log(`grid ${slot}: lateral ${t.project(p.x, p.y).lateral.toFixed(2)} m`);
}
