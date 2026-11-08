---
name: rc-ui
description: Build or change Garage Rumble client UI and look - screens (title, lobby, HUD, results), design tokens, components, HUD layout, Babylon.js scene, car model and effects. Use for any change in apps/client/src/ui, styles, or render.
---

# rc-ui

Read `docs/design-system.md` (tokens, components, HUD map, art direction, voice).

## Rules
* Colours, type, spacing and motion come only from `styles/tokens.css` variables. Tape yellow (`--rc-tape`) is the only accent.
* HUD text ≥ 18 px; numbers tabular; anchors via the `.hud` grid areas, never absolute pixels; respect `--rc-safe-*`.
* Screens are `Screen` objects on the `ScreenStack`. Each defines `focusTarget()`. Keyboard and gamepad must reach every control.
* The HUD is event-driven: `RaceClient` calls `hud.update(state)` on snapshots (diffed) and `show/pushFeed` on events. No polling loops in UI code.
* Build DOM with `h()` (`ui/dom.ts`). Never use `innerHTML` with player text (nicknames).
* `prefers-reduced-motion` disables animations (handled in tokens).

## 3D (Babylon.js 9, left-handed)
* Game `(x, y)` → `toWorld(x, y, height)` = Babylon `(x, height, y)`; yaw `rotation.y = -heading`.
* Car hierarchy: root (pose) → body (lean) + wheel pivots (steer) → tyre (spin around local Z) → rim/spokes/hub. Wheels roll by distance / radius.
* Pool every per-shot or per-effect mesh (`Pool` in `render/effects.ts`); never create meshes per frame.
* Static geometry: thin instances plus `freezeWorldMatrix()`.
* Materials: always `mat()` / `pbr()` from `render/materials.ts` (PBR). Use `surface` for scanned looks, `rough`/`metal`/`clearCoat` for the rest; never `StandardMaterial`, never flat emissive to fake light. Freeze static materials.
* Props: prefer a scanned model (`k.model(g, "Sofa_01", …)`, ids in `room/models.ts`) over primitives. New props or materials: add the Poly Haven id to `scripts/fetch-assets.py`, run `npm run assets`, commit the files and the CREDITS update. CC0 only.
* Read `docs/design-system.md` → "3D art direction" before changing the look. Installed helpers: `babylonjs-engine` (API/perf), `substance-3d-texturing` (PBR channels, budgets), `game-art-direction`.
* Check visuals with a headed browser: `window.__rc` exposes the client in dev (move `world.camera` for close-ups).

## Verify
`npm run typecheck`, then load the page, play a race, and screenshot the title, lobby, HUD and results at 1440×900 and 390×844 (phone).
