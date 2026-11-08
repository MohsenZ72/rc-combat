# Design system — "Workshop"

Garage Rumble is RC cars racing on a track taped onto a giant workshop floor. The visual language borrows from that space: **hazard tape yellow**, dark workbench steel, warm plank floors, and electric accents for weapons. The source of truth is `apps/client/src/styles/tokens.css`; components are in `ui.css`.

## Principles

1. **Readable at speed.** HUD text is at least 18 px, numbers use tabular figures, and key info sits in screen corners away from the road.
2. **One accent.** Tape yellow means "act here": primary buttons, focus rings, the item slot, and the current player's row. Nothing else uses it.
3. **Semantic colour only.** Red = damage/danger, cyan = electric (bolts, EMP, shield), green = health/verified, orange = warnings. Never decorative.
4. **Fair and honest UI.** Ranks and times say they are server-verified. Results under review are labelled, never hidden.
5. **Every screen works with keyboard and gamepad.** Each screen focuses one control when it opens; focus rings are always visible.

## Tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--rc-ink-950` | `#0d0f13` | page background, input fields |
| `--rc-ink-900` | `#151920` | panels (88% opacity over the 3D scene) |
| `--rc-ink-800` | `#1d232d` | raised surfaces, key caps |
| `--rc-ink-700` | `#2a3240` | borders |
| `--rc-ink-500` | `#4d5869` | disabled, empty seats |
| `--rc-ink-400` | `#8a95a8` | muted text |
| `--rc-ink-200` | `#c9d0db` | secondary text |
| `--rc-ink-100` | `#eef1f6` | primary text |
| `--rc-tape` | `#ffc933` | accent, focus, primary CTA, item slot |
| `--rc-tape-ink` | `#1b1500` | text on tape |
| `--rc-signal` | `#ff5a36` | damage, rockets, errors |
| `--rc-volt` | `#2fd3ff` | bolts, ammo pips, EMP, shield |
| `--rc-go` | `#3ddc84` | health, verified, GO |
| `--rc-warn` | `#ff9f1c` | wrong way, under review, turbo |

Car paints (`SLOT_COLORS` in `@rc/shared`) are cosmetic only and are assigned by seat. Every car has identical stats.

Contrast: text tokens on `--rc-ink-900` meet WCAG AA (ink-100 is about 15:1, ink-400 about 5.6:1). `--rc-tape-ink` on `--rc-tape` is about 13:1.

### Type

| Token | Family | Use |
|---|---|---|
| `--rc-font-display` | Chakra Petch 600/700 | titles, rank, buttons, callouts (uppercase) |
| `--rc-font-body` | Inter 400/600/700 | body, labels |
| `--rc-font-mono` | JetBrains Mono 500 | race timer, finish times |

| Size token | Value |
|---|---|
| `--rc-fs-hero` | `clamp(44px, min(9vw, 10vh), 112px)` |
| `--rc-fs-hud-xl` | `clamp(40px, 6vw, 84px)` (race position) |
| `--rc-fs-xl` | `clamp(28px, 3.2vw, 40px)` |
| `--rc-fs-lg` | `clamp(22px, 2.2vw, 28px)` |
| `--rc-fs-md` | `20px` |
| `--rc-fs-sm` | `18px` (minimum for HUD text) |

### Space, shape, motion

* Spacing: a 4 px grid, `--rc-space-1…7` = 4, 8, 12, 16, 24, 32, 48.
* Radius: 6 / 10 / 16 px. Border: 2 px. Panels carry an 8 px hazard-stripe top edge (`--rc-tape-stripes`).
* Motion: `--rc-dur-fast` 120 ms, `--rc-dur` 220 ms, ease-out `cubic-bezier(.2,.8,.2,1)`. All motion turns off under `prefers-reduced-motion`.
* Safe area: `--rc-safe-*` = `max(16px, env(safe-area-inset-*))` on every screen edge.

## Components

| Component | Class | Notes |
|---|---|---|
| Panel | `.panel`, `.panel--wide` | Max 560 / 860 px, hazard top edge, blurred backdrop. |
| Button | `.btn.btn--primary`, `.btn--ghost`, `.btn--block` | Minimum height 52 px (touch and TV friendly); 3 px tape focus ring offset 3 px. |
| Field | `.field > label + .input` | Labels always visible (no placeholder-only fields). |
| Key cap | `.kbd` | Controls help and item hint. |
| Badge | `.badge--go` / `--warn` / `--muted` | Verified, under review, bot. |
| Roster | `.roster > li` (`.is-empty`) | Auto-fill grid of 10 seats with a paint swatch. |
| Results table | `.table` (`tr.is-me`) | Tabular numbers; your row is tinted tape. |
| HUD grid | `.hud` with areas `tl tc tr / ml mc mr / bl bc br` | Anchored to corners; no absolute pixel positions. |
| Position | `.position` | Big rank plus `/total`. |
| Meter | `.meter` (`.is-low` < 35%) | HP; turns red-orange when low. |
| Ammo pips | `.pips > i` (`.is-spent`) | Cyan glow; 10 pips. |
| Item slot | `.item-slot` (`.has-item`, `.is-locked`) | Pops on pickup; greyed with a cyan border when EMP-locked. |
| Feed | `.feed > li` (`.is-info`) | Last 5 events, auto-expire after 5 s. |
| Callout | `.callout` (`.is-go`, `.is-warn`, `.is-pop`) | Countdown, GO, Lap N, Finish, Wrong way. |
| Minimap | `.minimap` (canvas) | Fixed north-up; you are the ringed dot. |
| Name tag | `.nametag` | Projected above remote cars, hidden past 120 m. |

## HUD layout

```text
┌──────────────────────────────────────────────────────────────┐
│ 3/10            (top centre free)                 01:42.366 │
│ Lap 2/5                                           ┌───────┐ │
│                                                   │minimap│ │
│                                                   └───────┘ │
│                         ┌──────┐                  Feed ▸    │
│                         │  3   │ ← callouts                 │
│                         └──────┘                            │
│ HP ████████░░ 82                                            │
│ ▮▮▮▮▮▮▯▯▯▯ ammo        [🚀 ROCKET  E use]                   │
│ [Shield] [Turbo]                                            │
└──────────────────────────────────────────────────────────────┘
```

Below 720 px wide the feed hides, panels tighten, and the item slot shrinks.

## 3D art direction

**Target: a real macro photograph of real diecast toys in a real house.** Nothing should read as cartoon.

* **Physically based everything** (`render/materials.ts`). Every material is a `PBRMaterial` (albedo, roughness, metalness, clear coat) lit by an HDRI of a real room or garden (`public/assets/env/<theme>.hdr`, Poly Haven CC0), plus one key light with cascaded PCF shadows and a soft bounce fill. Legacy `specular` options are mapped to roughness/metal; only near-mirror greys become bare metal.
* **Photo-scanned surfaces.** Floors, walls, wood, fabric, leather, stone and bark use CC0 scans (`public/assets/pbr/<id>/`: albedo, greyscale detail for tinting, OpenGL normal, ORM). Kit furniture gets box-projected UVs in metres so scans tile at real size. Brown colours become wood grain automatically; pass `surface` for fabric/leather/stone, or `"none"`.
* **Macro resolution.** The camera sits at toy height, so floors add a Babylon detail map (fine grain, 12× finer) and natural ground (lawn, sand, dirt, concrete) is shrunk to 30–50 % of real scale for more texels; man-made floors (planks, tiles, parquet) keep real size.
* **Scanned props** (`render/room/models.ts`, `public/assets/models/*.glb`): ~70 Poly Haven CC0 models (sofa, armchair, stove, microwave, kettle, fruit, rubber ducks, tool chest, barrels, grandfather clock, gnome, planters, stones…) optimised by gltf-transform (quantised, WebP ≤ 1024 px), loaded once per scene and instanced. `Kit.model()` places them in real metres; the track guard re-checks them after they load.
* **Lens.** HDR pipeline with ACES tone mapping, MSAA ×4, subtle bloom, grain, vignette and a little chromatic aberration; high quality adds SSAO2 contact shadows and depth of field focused on the player's car (miniature look). An adaptive governor sheds SSAO/DoF, then MSAA, then resolution if the frame rate stays under 45 fps. `?gfx=low` (or phones) starts in low.
* **Cars:** Catmull-Rom smoothed lofts with superellipse sections (no facets), lacquered paint (gloss / metallic flake / pearl iridescence / matte), smoked reflective glass, chrome bumpers and mirrors, chrome/gold/painted rims, rubber tyres.

* **Scale:** the cars are diecast toys; the house is giant (sofa, fridge, table legs, mugs, fruit, toy blocks, toy boxes).
* **Rooms, not backdrops.** `render/room/` builds each map as a furnished room (furniture kit in `furniture.ts`, layouts in `rooms.ts`): walls with dado line and skirting, windows with curtains, doors, pictures, ceiling lights, furniture against the walls at toy scale (1 cm ≈ 0.72 m), a centre piece where the track leaves space, and thin-instanced floor clutter. Pieces that would touch the racing line are dropped automatically.
* **Effects** (`render/fx/particles.ts`, pooled): rocket exhaust and smoke trail, fuse sparks on bombs, fire, smoke and debris explosions with camera shake, bolt sparks, EMP arcs, repair sparkles, tyre smoke while drifting, water spray, gift-box item boxes that burst into sparkles.
* **No asphalt, ever.** Themes (`apps/client/src/render/themes.ts`):
  * *Toy track*: orange plastic strip with guide grooves and piece joints on wooden planks; low orange rails plus a faint clear guard panel showing the real wall.
  * *Rug*: a finely tiled Persian-style field with a woven border band; walls of coloured toy building blocks; the rug drapes over cushion hills.
  * *Kitchen*: ceramic tiles continue under the racing line; pastel toy-block walls; water spills; a wooden serving tray section.
  * *Toy canyon*: blue plastic track on yellow stands over carpet, clear guards, a water tray at the bottom.
* **Car motion:** wheels roll by distance; front wheels steer; the body leans out of turns (filtered), squats under throttle and noses up in the air.
* **Feedback:** white flash on hit, cyan tint under EMP, transparent cyan bubble for shield or spawn protection, orange flame for turbo, flipped dark car when wrecked, ghosted at 45% when finished or disconnected.

## Voice

Short, direct, workshop-flavoured: "Pit lane", "Find a race", "Wrecked!", "Under review". No blame. System messages say what happened and what to do next ("Lost connection to the race server. Back to menu").
