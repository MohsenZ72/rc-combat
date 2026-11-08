# Garage Rumble

A browser-based, 10-player **toy-car combat racing** game with **server-authoritative** gameplay and layered anti-cheat. You race diecast toy cars round the house: an orange toy track, the living-room rug, the kitchen tiles and a toy-track canyon. You handbrake into drifts, jump clean over rivals and rockets, drop mines, and finish first. Rank comes from track progress, not kills.

* **Client:** TypeScript, Babylon.js (WebGL2), Vite, plain-DOM UI with design tokens
* **Game server:** Colyseus 0.18 over WebSocket, fixed 30 Hz simulation, Rapier 2D (WASM) physics
* **API:** NestJS 12, PostgreSQL 17, zod
* **Shared:** deterministic simulation (`@rc/game-core`) and wire protocol (`@rc/shared`) used by both client and server

> Working title. Original game, original code and assets. Inspired by the arcade combat-kart genre, not a copy of any game.

## Quick start

```bash
npm install
cp .env.example .env     # replace every CHANGE_ME (openssl rand -hex 32)
npm run db:up            # Postgres in Docker on :5433
npm run dev              # API :3000 · game server :2567 · client http://localhost:5173
```

Open <http://localhost:5173>, pick a name, press **Find a race**. With dev settings, empty seats fill with bots after 15 s.

**Controls:** W/S throttle and brake · A/D steer · **Space handbrake (drift)** · **Q jump** · F fire · E use item · **C look back**. A gamepad works too.

**Maps (10, each a furnished room or garden):** Toy Track Classic, Living Room Rug, Kitchen Tiles, Toy Track Canyon, Bathroom Splash, Garden Path, Bedroom Dash, Garage Workshop, Library Loop, Sandbox Dunes. Pick one or "Any map".

**Garage:** 8 body styles (low supercar to tall SUV), 8 rims × 6 colours, 4 tyre types, 16 paints × 4 finishes, 24 stickers, race number. Looks only: same hitbox and stats for everyone.

## Tests

```bash
npm test                                   # 112 tests (game-core 84, game-server 11, API e2e 17; needs db:up)
npm run typecheck
npm run loadtest -- --clients 200 --seconds 60
```

Load test (one laptop, 20 simultaneous matches, 200 clients): 0 errors, server at **22% of one core**, p99 tick **0.77 ms** (budget 33 ms), about **12 KB/s** per player. Details are in [docs/testing.md](docs/testing.md).

## How cheating is prevented

Clients send only an 8-bit button mask per tick. The server simulates position, speed, collisions, items, damage, cooldowns, checkpoints, laps, rank and results. Messages that try to set position, health, score or "finished" do not exist; any unknown message is scored and eventually kicked. On top of that sit a per-tick movement validator, a suspicion score with a review queue and automatic temporary suspensions, results checked against the registered roster and seed, and deterministic replays that can be re-simulated. Full threat table: [docs/system-design/03-anti-cheat.md](docs/system-design/03-anti-cheat.md).

## Repository

```text
apps/api            NestJS API + migrations
apps/game-server    Colyseus server, MatchSession, load test
apps/client         Babylon.js browser client
packages/shared     config, protocol, events, schemas
packages/game-core  simulation, physics, anti-cheat, replay, bots, prediction
docs/               system design, design system, patterns, ADRs, runbook, roadmap
.claude/skills/     project skills for AI agents
```

## Documentation

Start at [docs/README.md](docs/README.md). Persian overview: [README.fa.md](README.fa.md).

## Status

MVP (phase 1) is done: playable multiplayer loop, four house-themed maps with elevation, water and ramps, diecast cars, handbrake drift, jump, six items plus a zapper, anti-cheat, results, replays, load-tested. Web3 prize tournaments are designed but **not** implemented, and real-money play needs legal review first; see [docs/system-design/06-web3.md](docs/system-design/06-web3.md).

## Credits

Photo-scanned materials, HDRIs and 3D props are CC0 from [Poly Haven](https://polyhaven.com); see [apps/client/public/assets/CREDITS.md](apps/client/public/assets/CREDITS.md).
