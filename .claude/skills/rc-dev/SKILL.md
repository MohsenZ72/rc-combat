---
name: rc-dev
description: Run, test, load-test and debug the Garage Rumble stack (NestJS API, Colyseus game server, Babylon.js client, Postgres). Use when starting the project locally, running tests, reproducing a bug end to end, or checking performance.
---

# rc-dev: run, test, debug

## Start
```bash
npm install
cp .env.example .env            # replace CHANGE_ME; secrets: openssl rand -hex 32
npm run db:up                   # Postgres :5433 (compose or docker run fallback)
npm run dev                     # builds packages, then api :3000, game :2567, client :5173
```
* Dev defaults: `MIN_PLAYERS=1`, `FILL_WITH_BOTS=true`, `LOBBY_WAIT_SECONDS=15`, so a solo race with 9 bots starts after 15 s.
* The game server and the API run under `tsx` with `--conditions=source`, so they read workspace package sources directly. The API's `dist` build uses package `dist` (run `npm run build:packages` first).

## Test
| What | Command |
|---|---|
| all | `npm test` (needs Postgres) |
| core only | `npm test -w @rc/game-core` |
| server only | `npm test -w @rc/game-server` |
| API e2e | `npm test -w @rc/api` |
| types | `npm run typecheck` |
| false positives + balance + replay | `npx tsx --conditions=source packages/game-core/scripts/headless-race.ts <seed>`; it must print `anomalies 0` and `ok: true` |
| load | `npm run loadtest -- --clients 10|50|100|200 --seconds 45` (stack running) |

## Debug in the browser
* In dev, `window.__rc.debug()` returns slot, phase, seq/ack, the server car, the predicted car and the render tick.
* Simulate keys: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`.
* Render errors are caught per frame and logged once (`render frame failed`).
* Game server: `curl -H "x-internal-key: $INTERNAL_API_KEY" localhost:2567/metrics`.

## Common failures
* Inputs ignored → binary handler must be `onMessageBytes`.
* `Reflector` cannot be resolved → a CommonJS Nest plugin; remove it (ADR-005).
* Ports busy → old processes: `lsof -i :2567 -i :3000 -i :5173`.
* After changing `packages/shared`, rebuild it (`npm run build -w @rc/shared`) for anything that consumes `dist` (the API build, the client production build).
