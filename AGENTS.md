# AGENTS.md: rules for working in this repo

Read this before changing code. Then load the matching project skill from `.claude/skills/`.

## Golden rules

1. **The server is the authority.** Never add a client→server message that carries state (position, speed, health, ammo, inventory, score, rank, finish). Clients send `INPUT` (8-bit buttons) and `PONG` only. New actions become new button bits, validated on the server.
2. **Determinism.** `packages/game-core` must not read wall-clock time, `Math.random`, or anything environment-specific. Use `Rng` and ticks. If you change the simulation, `verifyReplay` must still pass.
3. **Shared code is shared.** Physics and protocol live in `@rc/game-core` / `@rc/shared` and run on both client and server. Do not fork them into an app.
4. **Every number in config.** Gameplay and anti-cheat values go in `DEFAULT_CONFIG` (`packages/shared/src/config.ts`), not inline.
5. **Zero false positives.** After any change to movement, physics, items or the validator, run the headless race on several seeds; it must report `anomalies 0` and `verify ok: true`.
6. **Tests first for anti-cheat.** Every new cheat vector gets a test in `packages/game-core/test/anticheat.test.ts` (or `jump.test.ts`, `match-session.test.ts`, the API e2e).
7. **No secrets in code or docs.** Only `.env` (gitignored) and `.env.example` placeholders.
8. **Docs stay true.** If you change behaviour, update the matching file in `docs/` in the same change (numbers, tables, tests counts).

## Commands

```bash
npm run db:up && npm run dev     # full stack
npm test                         # all suites (Postgres needed for API e2e)
npm run typecheck
npx tsx --conditions=source packages/game-core/scripts/headless-race.ts 7   # balance / false-positive check
npm run loadtest -- --clients 100 --seconds 45                              # stack must be running
```

## Gotchas (learned the hard way)

* Colyseus 0.18: binary client messages need `onMessageBytes`, not `onMessage`. Custom close codes must be 4011–4999. Use the installed `colyseus` skill.
* Nest 12 is ESM-only: put explicit `@Inject(Token)` on every constructor parameter; don't add CommonJS Nest plugins (dual-package `Reflector` bug under tsx).
* Babylon is left-handed: a game heading `h` is `mesh.rotation.y = -h`; game `(x, y)` → Babylon `(x, height, y)`.
* Schema 5: use the `t.*()` builders (`t.uint8()`), not raw strings.
* The validator compares against the **previous validated** state. Server-side placement must go through `RaceSimulation.placeCar` (or `respawn`), or it is flagged as a teleport, correctly.

## Where things are

See [docs/system-design/01-architecture.md](docs/system-design/01-architecture.md) § Repository layout, and [docs/README.md](docs/README.md).

## Git

* Branch from `main`, small commits, conventional messages (`feat:`, `fix:`, `docs:`, `test:`).
* Push with the GitHub CLI credential helper (SSH is not set up for this repo):
  `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`
