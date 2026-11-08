# Design patterns used

Each pattern is listed with where it lives and why it was chosen. When you add code, reuse these patterns before inventing new ones.

## Architecture

| Pattern | Where | Why |
|---|---|---|
| **Authoritative server / dumb client** | `RaceSimulation` on the server; the client sends `INPUT` only | The base of the anti-cheat. Nothing a client claims is trusted. |
| **Ports and adapters (hexagonal)** | `BackendPort` / `HttpBackend` (game server → API), `PrizeSettlementPort` / `FreeMatchSettlement` (API → payouts), `MatchSession` (rules) vs `RaceRoom` (Colyseus adapter) | Game rules are testable without sockets or HTTP. A Web3 escrow adapter later replaces `FreeMatchSettlement` without touching match code. |
| **Shared kernel** | `@rc/shared`, `@rc/game-core` | One implementation of protocol, config and physics on both sides. Prediction is only correct if client and server run the *same* code. |
| **Feature modules** | `apps/api/src/{auth,players,matches,anticheat,tournaments,health}` | NestJS feature slicing; each module owns its controller, service and repository. |
| **Repository** | `PlayersRepository`, `SessionsRepository`, `MatchesRepository` | SQL stays in one layer; services hold rules; transactions go through `Database.transaction`. |

## Simulation and netcode

| Pattern | Where | Why |
|---|---|---|
| **Fixed timestep game loop** | `RaceRoom` → `setFixedTimestep`, `RaceSimulation.step` | Deterministic integration independent of frame rate or server load. |
| **Command pattern (inputs as commands)** | 8-bit button mask with sequence numbers | Inputs are small, replayable and validatable; the server applies one per tick. |
| **Client-side prediction + server reconciliation** | `CarPredictor` | Instant local response without trusting the client. |
| **Entity interpolation** | `SnapshotInterpolator` | Smooth remote cars at 30 Hz updates. |
| **Deterministic replay / event sourcing (light)** | `ReplayRecorder` + `verifyReplay` | Seed + config + applied inputs + session controls fully reproduce a match, which is used for disputes and tests. |
| **Seeded RNG** | `Rng` (mulberry32) | All randomness (item rolls, bot personalities) is reproducible. |
| **Object pool** | projectile array in `RaceSimulation`; `Pool` in `render/effects.ts` | No allocations per shot or frame, so no GC spikes. |
| **Encode once, patch per recipient** | `encodeSnapshot` + `withSnapshotAck` | O(1) encoding per tick regardless of player count. |
| **Token bucket rate limiting** | `InputGuard`, `RateLimitGuard` | Burst tolerance for network jitter, hard cap for floods. |

## Anti-cheat

| Pattern | Where | Why |
|---|---|---|
| **Defence in depth** | protocol guard → authoritative sim → movement validator → race integrity → suspicion → review → sanctions | No single layer has to be perfect. |
| **Validator with correction** | `validateMovement` returns violations *and* a corrected state | Detect, correct and continue: never crash or desync on bad state. |
| **Scoring with decay and escalation** | `SuspicionTracker` | Tolerates latency noise; escalates repeated impossible events; config-driven thresholds. |
| **Idempotent receiver** | `MatchesService.finish` (`already_recorded`) | Safe retries of result uploads. |
| **Integrity check against a registered intent** | match registered at countdown, result checked against roster, seed and config hash | A result cannot invent players or change parameters after the fact. |

## Client UI

| Pattern | Where | Why |
|---|---|---|
| **Screen stack** | `ScreenStack` (`push/pop/reset`) | Title → lobby → HUD → results without boolean flag soup; focus handled per screen. |
| **Observer / typed event emitter** | `Emitter`, `Connection`, `RaceClient` events | The HUD reacts to events and snapshot diffs instead of polling game state. |
| **Facade** | `RaceClient` | One object wires network, prediction, rendering and HUD. |
| **Lazy loading** | `import("./game/race-client.js")` after the menu | The menu is interactive before Babylon and Rapier (about 2 MB) load. |
| **Design tokens** | `styles/tokens.css` | Single source for colour, type, space and motion; see [design-system.md](design-system.md). |

## Server operations

| Pattern | Where | Why |
|---|---|---|
| **Retry with exponential backoff** | `HttpBackend.withRetry` | Results survive brief API outages. |
| **Fail fast on config** | `loadEnv()` (zod) in every app | A missing secret crashes at boot, not at the first request. |
| **Advisory-locked migrations on boot** | `migrate()` | Several API instances can start at once safely. |
| **Graceful shutdown** | `gracefullyShutdown: true`, `onDispose`, `enableShutdownHooks` | Running matches are recorded as abandoned, not lost. |
