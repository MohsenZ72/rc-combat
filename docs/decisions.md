# Architecture decision records

Short ADRs. Each one has its context, the decision, and its consequences. Add new ones at the end; never rewrite an accepted one. Supersede it instead.

## ADR-001 · Server-authoritative simulation, inputs only from clients
**Context:** competitive play with future prize money; browsers are fully controllable by players.
**Decision:** clients send an 8-bit button mask per tick; the server simulates everything.
**Consequences:** most cheats have nothing to forge; latency is hidden with prediction and interpolation; the server pays the simulation CPU (measured at about 0.06–0.09 ms per match tick).

## ADR-002 · 2D physics plane with Rapier (`rapier2d-compat`), a scalar height for jumps
**Context:** the prompt asks for Rapier. The track is flat; a full 3D rigid-body car is costly and hard to keep deterministic and arcade-feeling.
**Decision:** horizontal movement in Rapier 2D (kinematic character controller sweeps against polyline walls, so nothing tunnels); a custom arcade car integrator; jump as a separate z/vz arc.
**Consequences:** cheap, deterministic (WASM), identical on client and server. No ramps or banked turns until a 3D move is justified.

## ADR-003 · Custom binary snapshots instead of Colyseus Schema for kinematics
**Context:** Schema delta sync is great for lobby state, but we need per-tick snapshots with a per-recipient ack and exact floats for reconciliation.
**Decision:** Schema for low-frequency room state (phase, roster); `sendBytes` snapshots at 30 Hz encoded once per tick.
**Consequences:** about 12 KB/s per player; full control over the format; two sync paths to maintain.

## ADR-004 · Merge `networking` and `config` packages into `@rc/shared`
**Decision:** one dependency-free package for protocol, config, events and zod schemas.
**Consequences:** client and server can't drift; one fewer build step.

## ADR-005 · NestJS with explicit `@Inject` tokens and our own rate-limit guard
**Context:** Nest 12 is ESM-only; `@nestjs/throttler` is CommonJS. Under `tsx` it loaded a second copy of `@nestjs/core`, so `Reflector` didn't resolve.
**Decision:** explicit `@Inject(...)` on every constructor parameter (works without decorator metadata) and an in-house `RateLimitGuard`.
**Consequences:** works with tsx, vitest and tsc alike. The rate limiter is per-instance; move counters to Redis when scaling the API horizontally.

## ADR-006 · zod for validation (not class-validator)
**Decision:** the same zod schemas (`matchOutcomeSchema`, `guestLoginSchema`…) validate on the game server, in the API (`ZodPipe`) and in the client.
**Consequences:** one contract, no DTO duplication.

## ADR-007 · Raw SQL with `pg`, SQL migrations, a repository layer
**Decision:** no ORM. Parameterised SQL in repositories; numbered `.sql` migrations applied with an advisory lock.
**Consequences:** transparent queries and transactions; schema changes are explicit SQL.

## ADR-008 · Guest sessions with revocable session rows (HS256 shared with game servers)
**Decision:** a JWT carries `sub` + `sid`; every use checks the live session row (cached for 30 s on game servers). Suspension revokes all sessions.
**Consequences:** instant bans and logouts. HS256 means the game server can mint tokens; move to EdDSA/ES256 (API signs, servers verify only) before untrusted operators run game servers.

## ADR-009 · Plain DOM UI with a screen stack (no React)
**Context:** the prompt allows React "only where useful". The UI is about 5 screens and a HUD.
**Decision:** small DOM helpers, a `ScreenStack`, a typed emitter and CSS design tokens.
**Consequences:** about 25 KB of UI code, no virtual-DOM work per frame next to the 3D render. Revisit if the meta-game UI (store, profile, tournaments) grows.

## ADR-010 · Web3 only for money, never for gameplay
**Decision:** see [06-web3.md](system-design/06-web3.md). A settlement port now; escrow on Base and USDC later; results signed by the server.
**Consequences:** gameplay is unaffected by chain latency or fees. Trust in the result signer is mitigated by KMS, multisig, timelock, an independent replay verifier and a refund deadline.

## ADR-011 · Jump as a default ability
**Context:** the product owner asked for a default jump.
**Decision:** edge-triggered, ground-only, 1.1 s cooldown, apex about 1.2 m, below the 1.4 m walls (and walls are infinite in physics anyway). Airborne cars dodge bolts, rockets and mines and can clear a car.
**Consequences:** a skill counter to every projectile. The validator covers height, take-off speed and mid-air lift.
