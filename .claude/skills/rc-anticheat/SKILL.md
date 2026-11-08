---
name: rc-anticheat
description: Work on Garage Rumble anti-cheat - InputGuard, movement validator, race integrity, suspicion scoring, sanctions, review queue, replays. Use when adding a cheat check, tuning thresholds, investigating a flagged match, or whenever a gameplay change could create a new exploit.
---

# rc-anticheat

Read `docs/system-design/03-anti-cheat.md` (threat table plus layers).

## Workflow for a new cheat vector
1. **Write the failing test first** in `packages/game-core/test/anticheat.test.ts` (simulation-level), `apps/game-server/test/match-session.test.ts` (protocol/session) or `apps/api/test/api.e2e.test.ts` (results/sanctions).
2. Prefer **removing the capability** (the server decides) over detecting it.
3. If detection is needed, add an `AnomalyKind` in `packages/shared/src/config.ts` with points in `DEFAULT_CONFIG.antiCheat.points`:
   minor (<5) = network noise, decays; moderate (5) = physics edge; major (20) = impossible, escalates ×2.5 on repeat.
4. Detect it in the right layer: `InputGuard` (packets), `validateMovement` (per-tick kinematics, return a **corrected** state), `race.ts` (gates/progress), `RaceSimulation` (items/weapons).
5. Run the headless race on ≥3 seeds: **must stay `anomalies 0`**. A false positive punishes honest players; tolerance beats strictness.
6. Add the row to the threat table in the doc.

## Rules
* Validate against the **previous validated state** (`this.prev`, committed at end of tick). Server-side moves must use `placeCar`/`respawn`.
* Impulses (bumps, hits) set `car.impulseThisTick`; respawns set `respawnedThisTick`. Validators excuse those, nothing else.
* Never auto-ban permanently. Max automatic action = `temporary_suspension` (API `AnticheatService`).
* Anomaly details never go to clients (private events filter in `MatchSession.step`).

## Investigating a match
* `GET /internal/review-queue` (flags inline), `GET /internal/matches/:id/replay`.
* `verifyReplay(rapier, replay, WORKSHOP_CIRCUIT)` → `ok`, `firstMismatch`, `maxPositionError`.
* Telemetry per player: `match_players.telemetry` (max speed/accel/yaw, packet jitter, ping, drops, rejects).

## Thresholds
`DEFAULT_CONFIG.antiCheat.thresholds`: suspicious 5 · flagged 20 (review) · restricted 50 (result unverified) · match_invalidated 80 · temporary_suspension 150.
