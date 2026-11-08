# Runbook

## Prerequisites

* Node ≥ 22.12 (developed on 24) and npm 11
* Docker (for Postgres), or any Postgres 15+ reachable through `DATABASE_URL`

## First run

```bash
npm install
cp .env.example .env          # then replace every CHANGE_ME (openssl rand -hex 32)
npm run db:up                 # Postgres 17 on localhost:5433 (docker compose or docker run)
npm run db:migrate            # optional: the API also migrates on boot
npm run dev                   # builds packages, then API :3000, game server :2567, client :5173
```

Open <http://localhost:5173>, enter a racer name, press **Find a race**. With the dev defaults (`MIN_PLAYERS=1`, `FILL_WITH_BOTS=true`, `LOBBY_WAIT_SECONDS=15`) a race with 9 bots starts after 15 s. Open more tabs or browsers to race other humans (one seat per account, so use a separate browser profile or a private window per player).

## Commands

| Command | What |
|---|---|
| `npm run dev` | all three apps with reload |
| `npm test` | every test suite (needs Postgres) |
| `npm run typecheck` | strict TypeScript everywhere |
| `npm run build` | production builds (`dist/` per app, client in `apps/client/dist`) |
| `npm run loadtest -- --clients 100 --seconds 60` | load test against a running stack |
| `npm run assets` | re-fetch the CC0 materials, HDRIs and scanned props from Poly Haven into `apps/client/public/assets` (already committed, so only needed to change them; needs any `python3`, `cwebp` and `npm install`; Pillow and numpy go into `.cache/assets-venv` automatically; `npm run assets -- --force` rebuilds) |
| `npx tsx --conditions=source packages/game-core/scripts/headless-race.ts 42` | 10-bot race without networking (balance, false positives, replay check) |

## Environment

See `.env.example`; every variable is documented there. Secrets: `JWT_SECRET`, `INTERNAL_API_KEY`, `POSTGRES_PASSWORD`. **Never commit `.env`.** Production must set `NODE_ENV=production`, which disables `/internal/test/guests` and enforces the WebSocket `Origin` allow-list.

## Health and metrics

* API: `GET /health` (DB ping).
* Game server: `GET /health`, `GET /metrics` (header `x-internal-key`): rooms, players, tick ms avg/p50/p99/max, KB/s in and out, memory, CPU. Each call resets the rolling window.
* Logs: pino JSON (game server), Nest console logger (JSON in production).

## Anti-cheat operations

* Review queue: `GET /internal/review-queue` (internal key) lists open cases with their flags.
* Replay for a match: `GET /internal/matches/:id/replay` returns gzip+base64 JSON. Verify it with `verifyReplay(rapier, replay, WORKSHOP_CIRCUIT)` from `@rc/game-core`.
* Thresholds and points: `DEFAULT_CONFIG.antiCheat` in `packages/shared/src/config.ts`. Change, run the headless race over several seeds, and confirm **zero** anomalies before shipping.
* Lift a suspension early: `UPDATE players SET status='active', suspended_until=NULL WHERE id=…` (until the admin UI exists).

## Production checklist

* [ ] TLS everywhere (WSS for the game server).
* [ ] `/internal/*` and `/metrics` reachable only on the private network.
* [ ] Strong unique `JWT_SECRET` and `INTERNAL_API_KEY`, kept in a secret manager.
* [ ] `CLIENT_ORIGINS` set to the real web origin(s).
* [ ] `FILL_WITH_BOTS=false` and `MIN_PLAYERS` ≥ 2 for competitive queues.
* [ ] Several game-server processes need `RedisPresence` + `RedisDriver` in `defineServer` (`@colyseus/redis-presence`, `@colyseus/redis-driver`).
* [ ] Several API instances: move rate-limit counters to Redis or rate-limit at the load balancer.
* [ ] Postgres backups and a replay retention job.
* [ ] Load test from a separate machine before launch.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid … environment` on boot | `.env` missing or a `CHANGE_ME` left; secrets need ≥ 32 / 24 characters. |
| Client stuck on "Joining…" | Game server down, or the API is unreachable from the game server (session validation). Check both logs. |
| `Nest can't resolve dependencies … Reflector` | A CommonJS Nest plugin loaded a second `@nestjs/core` under tsx; see ADR-005. |
| Inputs ignored (car never moves) | Binary messages must be registered with `onMessageBytes` in Colyseus 0.18. |
| Port 2567/3000/5173 busy | An old dev process is still running; stop it (`lsof -i :2567`). |
| `docker: unknown command: docker compose` | The compose plugin is missing; `npm run db:up` falls back to `docker run`. |
