---
name: rc-gameplay
description: Add or change Garage Rumble gameplay - items, weapons, abilities (jump, drift), car handling, balance numbers, item roll weights, bots. Use for any change to RaceSimulation rules, vehicle.ts, bot.ts or DEFAULT_CONFIG gameplay values.
---

# rc-gameplay

Read `docs/game-design.md`.

## Add an item
1. `ItemKind` + `ITEM_NAMES` in `packages/shared/src/protocol.ts`; config block in `ItemConfig` / `DEFAULT_CONFIG.items`.
2. Add it to `ITEM_ORDER` and both weight tables (`ITEM_WEIGHTS_FRONT/BACK`) in `simulation.ts`.
3. Implement it in `RaceSimulation.tryUseItem`: check every precondition and **reject without consuming** if the target is invalid.
4. Projectile? Reuse the pooled `projectiles` (`spawnProjectile`); hits go through `projectileHit` (respects shield, spawn protection and jump height).
5. Client: icon in `ui/hud.ts` `ITEM_ICONS`, visuals in `render/effects.ts` (pooled), feed text in `RaceClient.onEvents`.
6. Bot usage in `BotDriver.combat`.
7. Tests: ownership, single use, cooldown, invalid target, effect.
8. Headless race ×3 seeds: anomalies 0, sensible hit/wreck counts. Update `docs/game-design.md`.

## Handbrake, jump, terrain
* Handbrake (`BTN.HANDBRAKE`, Space): `handbrakeDeceleration`, `handbrakeGrip`; drift holds with throttle + steer (`integrateMovement`).
* Jump (`BTN.JUMP`, Q): `jumpVelocity`, `gravity`, `jumpCooldown`; apex = v²/2g must stay below the 2.8 m barrier visuals and above `bodyHeight` (1.0 m) so cars can clear each other.
* Terrain comes in as `Surface { slope, water }` from `Track.surfaceUnder`; ramps launch in `RaceSimulation.updateRace` and in `CarPredictor`.

## Change car handling
* Edit `DEFAULT_CONFIG.car`; the integrator is `integrateMovement` (shared with client prediction).
* The validator derives limits from the same config (`movementLimits`, `absoluteSpeedCeiling`, `maxJumpHeight`). If you add a new speed or height source, extend those helpers and the validator.
* Keep the jump apex (`v²/2g`) below the visual wall height (1.4 m).

## Balance loop
`npx tsx --conditions=source packages/game-core/scripts/headless-race.ts <seed>` prints lap times, results, event counts (hits, wrecks, jumps) and the replay check. Target: winning time 3.8–4.2 min for 5 laps, every bot finishes, zero anomalies.

## Fairness
No stat may depend on account, payment or cosmetics. Item rolls use the seeded `Rng` and rank only.
