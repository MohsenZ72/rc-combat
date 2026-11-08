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
**Context:** the product owner asked for a default jump, then for it to be high enough to clear another car.
**Decision:** edge-triggered (Q), ground-only, 1.3 s cooldown, apex about 2.1 m (body height 1.0 m), so a car jumps cleanly over another. Visual barriers are 2.8 m and physics walls are infinite, so jumping never leaves the track.
**Consequences:** a skill counter to every projectile. The validator covers height, take-off speed and mid-air lift.

## ADR-012 · Handbrake on Space, separate from the brake
**Context:** the owner wanted a handbrake that differs from braking and enables drifting.
**Decision:** `BTN.HANDBRAKE` (bit 4, replacing the old drift button): gentle rear-lock deceleration, very low lateral grip, drift yaw multiplier; throttle + steer holds the slide after release. Jump moved to Q.
**Consequences:** drifting is a real technique; it uses the same integrator on server and client, so prediction stays exact.

## ADR-013 · House-themed maps, no road, diecast cars
**Context:** the owner asked for no road, diecast toy cars, and tracks on toy track, a rug or kitchen tiles, with hills and water.
**Decision:** `TrackDefinition` gains `theme`, optional heights per control point, water ranges, ramps and per-track laps. Physics stays 2D; the track's height profile feeds slope and water into the shared integrator, ramps launch cars, and rendering follows the ground. The client builds the theme (floor, surface continuing the floor, toy blocks or plastic rails, skirts or stands, water, props) and lofted diecast car bodies with liveries. Matchmaking filters by chosen map (`filterBy(["track"])`).
**Consequences:** 4 maps with no new physics engine. No overpasses (2D walls can't cross); crest launches over hilltops are future work.

## ADR-015 · Cosmetics whitelist, rooms built from a furniture kit
**Context:** the owner asked for customisable cars (tall/short bodies, rims, stickers) and much more detailed, furnished maps (a kitchen with a washing machine, a dishwasher…).
**Decision:** cosmetics are ids from a shared zod whitelist, stored per player, re-validated by API and game server, and visual only. Rooms are generated from a primitive furniture kit, merged per material, with thin-instanced clutter; AI-generated 3D (Higgsfield) is reserved for hero props and items once credits exist, because AI car meshes fuse wheels to the body.
**Consequences:** no asset pipeline needed yet, everything is reproducible from code, and draw calls stay low (merged furniture, thin instances).

## ADR-014 · Render-loop-driven prediction with interpolation
**Context:** the owner reported the car shaking while driving.
**Decision:** run input and prediction from the render loop with a fixed-step accumulator; draw the local car between the last two predicted steps; low-pass the body-lean inputs.
**Consequences:** no 30 Hz stepping or trembling. A hidden tab sends a neutral input (rendering, and therefore input, pauses).

## ADR-016 · Photoreal look: PBR, HDRI lighting, CC0 scans and scanned props
**Context:** the owner said the game still looked "very, very cartoony" and asked for it to look real and natural. Higgsfield credits were empty, so paid AI generation was not an option.
**Decision:** switch every material to PBR lit by per-theme HDRIs; replace hand-drawn canvas textures with photo-scanned CC0 materials (Poly Haven) at real-world scale, with detail maps for macro distance; replace most primitive furniture with ~70 photo-scanned CC0 glTF props (Poly Haven), optimised with gltf-transform and instanced; add an HDR post-process stack (ACES, SSAO2, depth of field, cascaded PCF shadows) with an adaptive quality governor. Assets are fetched reproducibly by `npm run assets` (`scripts/fetch-assets.py`) and committed (~60 MB) so the game runs offline and CI needs no network; licences and sources are in `public/assets/CREDITS.md`.
**Consequences:** realistic rooms with real objects and no new runtime dependency except `@babylonjs/loaders` (lazy chunk). Repository grows by ~60 MB of binary assets (CC0). Cars stay procedural (AI or scanned car meshes fuse wheels and can't be customised). Low-end devices fall back automatically.

## ADR-017 · Impulse-based collisions with spin, traction loss and flips
**Context:** the owner said the physics felt bad: hitting walls or other cars should knock a car off balance. Cars bumped like equal discs (no spin, no lean) and walls stopped or slid cars.
**Decision:** a shared, deterministic impact model (`packages/game-core/src/impact.ts`) in the 2D sim. Car-to-car contacts use capsules along the heading (2.6 m × 1.5 m) and a rigid-body impulse with mass, yaw inertia, restitution and Coulomb friction, so off-centre hits spin cars and a turbo car rams harder. Walls bounce with restitution and turn the car about the impacting end. Every hit feeds a short traction loss and a roll/pitch spring; a very hard sideways hit (or a rocket) scripts a full roll that lands upright. New car state (`spin`, `tractionTicks`, `flipTicks`, `roll`, `pitch` + rates) is part of `MovementState`, predicted by the client and sent in snapshots (+8 B per car, protocol version 2). The movement validator allows heading change up to steering plus the spin carried into the tick, rejects spin above `impact.maxSpin`, and rejects spin that grows without an impact; wall impacts now set `impulseThisTick`. All numbers live in `DEFAULT_CONFIG.impact`.
**Consequences:** hits read clearly (spin-outs, two-wheel tips, flips, sparks) with no new physics engine and exact replays. Roll and pitch are rendered by tilting the whole car about its centre of mass, so no render-module change was needed. Snapshots grow from 40 to 48 B per car (about 12 → 14.5 KB/s per player, computed, not re-measured). Three latent bugs found on the way were fixed: an EMP that cancelled a target's turbo later in the same tick made its legal turbo acceleration look like a cheat (the validator now uses the turbo state the integrator saw), a NaN wall normal from Rapier on degenerate contacts (now skipped) and a car at rest that could never pull away when its forward speed rounded to a tiny negative.
