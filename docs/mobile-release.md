# Mobile release plan: Android APK/AAB on Cafe Bazaar

Status (2026-11-10): **planned, not started.** The owner asked whether the game can ship as an APK on Cafe Bazaar. The answer is yes, using the offline build. This document records the plan so a later session can start without re-deriving it.

## Why it is feasible

* The public web build (ADR-018) already runs a full race against 9 bots in the browser. `LocalConnection` runs `MatchSession` from `@rc/game-core`, so no server, account or network is needed. That is the build we wrap.
* Capacitor 8 wrapping already works on this Mac for the owner's other Bazaar games (`~/Documents/div-runner`, `~/Documents/div-shekamoo`). Reuse their setup; see `div-runner/docs/08-release.md`.
* Phones already default to the `low` graphics tier (`pickGfx()` in `apps/client/src/render/world.ts`: touch device with short side < 900 px), and the adaptive governor sheds SSAO, depth of field, MSAA and resolution when fps drops below 45.

## What is missing

### 1. Touch controls (largest piece)
The client has keyboard and gamepad input only (`apps/client/src/game/input.ts`); there is no on-screen control. Needed:

| Action | Touch control |
|---|---|
| Steer | left thumb: left/right pads or a horizontal drag zone |
| Throttle / brake | right thumb: gas and brake pads (auto-throttle option) |
| Handbrake / drift | right-hand button |
| Jump | button |
| Fire zapper | button |
| Use item | button (shows the held item icon) |
| Look back | small button |

Rules: landscape lock, safe-area insets (`env(safe-area-inset-*)`), multi-touch (steer + gas + fire at once), buttons ≥ 48 px, map touches into the same button bitfield `encodeInput` already uses so prediction and anti-cheat are unchanged. Show touch UI only when `navigator.maxTouchPoints > 0` and no gamepad is connected. Follow `docs/design-system.md` tokens.

### 2. Mobile performance
* Measure fps on the emulator and, if possible, a real mid-range phone for every map. Garden was the slowest map on desktop (~37 fps at 3024 px before the governor).
* Probably needed: lower hardware scaling on start for phones, 512 px textures for the `low` tier, fewer shadow cascades, no SSAO on phones.

### 3. Size
`apps/client/dist` is about 71 MB (≈ 61 MB CC0 assets in `public/assets`). Expect an APK of about 75 MB. Options to shrink: a 512 px texture set for the mobile build, fewer HDRIs (one per theme already), dropping unused models.

### 4. Capacitor wrap
* New `apps/mobile` (or a `capacitor.config.json` in `apps/client`) with `webDir` = the offline build. Build with `vite build --mode pages` and `PAGES_BASE=./` so assets resolve from the app bundle.
* App id proposal: `com.mohsenz72.garagerumble`.
* Its own release keystore, **outside git** (pattern from div-runner: `~/.android-keys/<app>-release.jks` + `.properties`, password in the macOS Keychain). This Mac has **no backups**: the owner must copy the keystore somewhere safe, or future updates can never be signed.
* Build environment: `JAVA_HOME` = Homebrew `openjdk@21`, `GRADLE_USER_HOME=~/.gradle-noproxy` (the global `~/.gradle/gradle.properties` points at a dead proxy `127.0.0.1:2080`).
* Emulator testing: the AVD needs `-gpu host`; the SwiftShader software GPU shows no 3D.
* Output: signed AAB/APK for Bazaar.

### 5. Store listing (Persian)
* Persian name and description (proposal: «غوغای گاراژ»), icon, 4–8 landscape screenshots from real gameplay, age rating (toy-car combat, no blood), category Racing.
* Price model is the owner's decision. Paid or in-app purchases must use Bazaar's Poolakey SDK.

## Must stay out of the Bazaar build
* **Web3** (wallet sign-in, USDC escrow): sanctions and Bazaar rules. The offline build has none of it; keep it that way (`VITE_OFFLINE_ONLY`).
* Online multiplayer: the APK is offline vs bots only until the API, game server and Postgres are hosted somewhere reachable from Iran.

## Owner-only blockers (not code)
1. Bazaar developer account `zmohsen72` is **expired**; renewal is 400,000 rial per year.
2. Publisher info is «ناقص»: needs the national card image.

These same two blockers already stop «دیو دونده» (draft 233912) and «دیو شکمو» (draft 233907) from being submitted.

## Order of work
1. Touch controls + landscape/safe-area, tested in Chrome device emulation.
2. Mobile performance pass (emulator with `-gpu host`).
3. Capacitor wrap, keystore, signed AAB/APK; full race on the emulator.
4. Store assets (icon, screenshots, Persian text) and a Bazaar draft.
5. Owner renews the account and completes publisher info, then submits.
