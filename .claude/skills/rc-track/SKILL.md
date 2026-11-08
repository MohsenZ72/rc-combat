---
name: rc-track
description: Create or edit a Garage Rumble race track (TrackDefinition control points, width, checkpoints, item rows) and its decoration. Use when designing a new map or changing the Workshop Circuit layout.
---

# rc-track

## Model
`TrackDefinition` (`packages/game-core/src/track.ts`): a closed loop of control points `[x, y, height?]` (metres) → centripetal Catmull-Rom (height on the same parameter) → resampled every `sampleSpacing` m. Walls = boundaries at ±width/2 (Rapier polylines, 2D, so **no overpasses**). `checkpointCount` gates spread evenly by arc length; gate 0 = start/finish. Also: `theme` (`toy-track | rug | kitchen | toy-canyon`), `water: [{from,to}]` and `ramps: [{at}]` as lap fractions, and `laps` (use 4 for long or hilly maps so the race stays near 4 min). Keep the start/finish area flat and straight.

## Steps
1. Copy `tracks/workshop-circuit.ts` and register it in `TRACKS`.
2. Constraints (enforced by `core.test.ts › track`):
   * `minCurvatureRadius()` > 1.5 × half-width, or the inner wall self-intersects.
   * Distant parts of the loop ≥ 3 × width apart (no wall overlap or shortcuts through thin walls).
   * Every grid slot and item box inside the track.
3. Lap length ≈ 1.0–1.2 km for 5 laps in about 4 min at 30 m/s top speed.
4. Checkpoints: one every 60–80 m (more gates = earlier shortcut detection).
5. Quick check: `npx tsx --conditions=source packages/game-core/scripts/track-check.ts <trackId>` prints length, curvature, clearance and grid offsets with OK/FAIL.
6. Run the headless race with the new track id: every bot must finish, `anomalies 0`.
7. Visuals come from the theme (`apps/client/src/render/themes.ts`): floor, surface (continues the floor, never asphalt), barriers (rails or toy blocks, 2.8 m), skirts or stands for raised parts, water, ramps, props. A new theme needs an entry there and a case in `world.ts`. Props are visual only; keep them outside `halfWidth + 10 m`.
   Grades ≤ 25% (track-check enforces it). Steep downhill grades add legal acceleration; the validator allows it via `extraAcceleration`.
8. Server: select the track in `apps/game-server/src/index.ts` (one track per server today); client `RaceClient` uses `WELCOME.trackId`.
