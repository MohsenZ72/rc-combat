# Testing

## Suites

| Suite | Command | Count | Needs |
|---|---|---|---|
| Game core: simulation, physics, collisions (impulses, spin, traction, tilt, flips), race, items, jump, handbrake, terrain, all 10 tracks, anti-cheat, replay, prediction, protocol | `npm test -w @rc/game-core` | 103 | — |
| Game server (`MatchSession`): lifecycle, kicks, reconnection, AFK, abandonment, verdicts, replay | `npm test -w @rc/game-server` | 11 | — |
| API e2e (real Postgres, incl. cosmetics whitelist) + payout planner | `npm test -w @rc/api` | 17 | `npm run db:up` |
| Everything | `npm test` | 131 | Postgres |
| Type checks | `npm run typecheck` | — | `npm run build:packages` once |
| Headless 10-bot race (balance + false-positive check) | `npx tsx --conditions=source packages/game-core/scripts/headless-race.ts [seed] [trackId]` | — | — |
| Track geometry check | `npx tsx --conditions=source packages/game-core/scripts/track-check.ts [trackId]` | — | — |
| Load test | `npm run loadtest -- --clients N --seconds S` | — | API + game server running |

## Required anti-cheat cases → tests

| Requirement | Test |
|---|---|
| normal movement → accepted | `accepts normal movement`, `accepts a full honest 10-bot race with zero anomalies` |
| speed hack → rejected/corrected | `rejects and corrects a speed hack`, `speed hack by input flooding gains no distance` |
| teleport → rejected/corrected | `rejects and reverts a teleport`, `corrects corrupted state inside the live simulation`, `reverts a sideways teleport through the wall` |
| invalid checkpoint → rejected | `rejects a skipped checkpoint`, `does not count a lap from crossing the finish line back and forth` |
| duplicate item → rejected | `picking up a box while holding an item does not duplicate items`, `an item is consumed on use and cannot be used twice`, `holding USE_ITEM fires an item only once` |
| invalid weapon cooldown → rejected | `enforces weapon cooldown: 3 s cooldown never allows a shot after 0.2 s` |
| impossible fire rate → rejected | `holding FIRE cannot exceed the server fire rate or ammo` |
| fake finish request → rejected | `fake finish / score / health / position requests have no message type`, `cannot finish by teleporting to the finish line`, server `fake finish / score / health messages are rejected and counted, state unchanged` |
| fake score → rejected | same as above (no message type; counted as `forbidden_message`) |
| fake health → rejected | same, plus `health and damage are server-owned: a shield blocks a rocket` |
| forged result to the API | API `rejects a result whose roster differs…`, `…from another server or with different match parameters`, `rejects duplicate ranks and corrupt replays` |
| jump abuse | `jump.test.ts` (no bunny-hop, no double jump, validator rejects flying / mid-air lift) |
| legit knockback never flagged, fake spin rejected | `impact.test.ts` (`a full-speed T-bone flips and spins the victim, with zero anti-cheat anomalies`), `anticheat.test.ts` (`accepts the extra yaw of a decaying impact spin`, `rejects spin that grows without an impact`, `rejects spin above the ceiling…`) |
| every map is fair and false-positive free | `tracks.test.ts` (geometry, grid, 90 s 10-bot race with zero anomalies per map), ramps and water |

## Load test results

Run on one MacBook (8 cores). The load generator (N SDK clients in one Node process), the game server, the API and Postgres all shared the machine. Tick rate 30 Hz, snapshots every tick, 45 s per scenario, bots driving every client through real WebSockets.

| Scenario | Rooms | Joined / errors | Join p50 / p99 | Snapshot interval p50 / p99 | Server tick avg / p99 / max | Server CPU (1 core) | Out | Per client |
|---|---|---|---|---|---|---|---|---|
| 10 players (1 match) | 1 | 10 / 0 | 114 / 148 ms | 33.5 / 46.7 ms | 0.63 / 3.88 / 76 ms | 6.0 % | 148 KB/s | 12.2 KB/s |
| 50 concurrent | 5 | 50 / 0 | 198 / 223 ms | 33.4 / 83.9 ms | 0.65 / 5.75 / 238 ms | 12.6 % | 624 KB/s | 12.0 KB/s |
| 100 concurrent | 10 | 100 / 0 | 416 / 496 ms | 33.4 / 66.7 ms | 0.48 / 3.96 / 169 ms | 16.0 % | 1.22 MB/s | 12.0 KB/s |
| 20 matches (200 players) | 20 | 200 / 0 | 553 / 764 ms | 33.5 / 66.3 ms | 0.23 / 0.77 / 84 ms | 22.5 % | 2.42 MB/s | 12.1 KB/s |

Headless simulation cost (no networking): about 0.06–0.09 ms per tick for a 10-car match.

### Bottlenecks found

1. **Synchronous replay gzip at match end** blocked the event loop for every room on the process. **Fixed**: async `zlib.gzip` on the threadpool.
2. **Rare long ticks (max 76–238 ms)** while the p99 stays under 6 ms. They line up with room creation and match end (JSON stringify of the replay, result upload) and GC, made worse by the load generator sharing the CPU. Next steps: move the replay to a worker thread or stream it, and run the load generator on a separate machine.
3. **Outbound bandwidth** grows linearly (about 12 KB/s per player at 30 Hz). 1,000 players is about 100 Mbit/s. Options: snapshot divisor 2 (half the bandwidth, interpolation absorbs it), quantised positions (int16 instead of f32 saves about 35%), delta snapshots, and area-of-interest for spectators.
4. **One event loop per process.** Capacity is CPU-bound around ~100 matches per core in theory, but in practice limited by GC and JSON. Scale out with several processes plus `RedisPresence`/`RedisDriver`.
5. **Join latency** grows with concurrent joins (guest sessions are validated against the API for every join). It is cached for 30 s per session; batch or skip re-validation for reconnects.

Reports are written to `apps/game-server/loadtest-report-<label>.json` (gitignored).
