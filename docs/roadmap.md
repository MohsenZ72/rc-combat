# Roadmap, known limitations

## Known limitations (honest list)

* **Cars are procedural.** Rooms use photo-scanned CC0 materials and props with PBR/HDRI lighting (ADR-016), but car bodies are lofted geometry, and a few props (washer, dishwasher, fridge, bathtub, toilet, item boxes) are still primitives. **No audio** yet.
* **Keyboard and gamepad only.** No touch controls, so phones can open the public build but cannot drive (see [mobile-release.md](mobile-release.md)).
* **Public build is offline only.** https://mohsenz72.github.io/rc-combat/ races 9 bots in the browser (ADR-018). Online multiplayer for the public needs a hosted API, game server and Postgres.
* **Four maps on a 2D physics plane with a height profile.** No overpasses or loops, no banking, no launch off hill crests (only ramps and jumps).
* **Prediction ignores remote-car motion.** Other cars are static obstacles at their last snapshot, so close side-by-side racing shows small corrections. Remote cars are drawn 70 ms in the past.
* **Rocket/bolt hits are judged on the server's present**, with no lag compensation (rewind). High-ping shooters must lead their target more. Fine for 30 Hz WebSockets at normal pings; add rewind later if needed.
* **WebSocket (TCP)**: head-of-line blocking on packet loss. WebTransport/WebRTC data channels are a later option.
* **Guest accounts only.** No email or wallet login yet; guests are easy to create (rate-limited).
* **HS256 shared secret** between API and game servers (ADR-008).
* **Single-process defaults.** Multi-process needs Redis presence/driver; the API rate limiter is in-memory.
* **Bots exist for casual fill and load tests.** They are not tuned AI and have no difficulty levels.
* **Determinism holds on the same build and platform.** Cross-platform replays are not guaranteed bit-exact (JS `Math.sin/cos`).
* **No admin UI** for the review queue; it is JSON endpoints only.
* **Bundle size:** the 3D chunk is about 1.6 MB gzip (Babylon via the root `@babylonjs/core` import) plus 1.3 MB for Rapier's WASM. Both lazy-load after the menu. Next: deep imports (`@babylonjs/core/Meshes/...`) to tree-shake, and the non-compat Rapier build with a separate `.wasm` file.
* **Behavioural cheat detection** (input bots, collusion) is not implemented; see the anti-cheat doc.

## Next steps (priority order)

### 1. Gameplay polish
* Replace the remaining primitive props (washer, dishwasher, fridge, bathtub, toilet, item boxes) with scanned CC0 models. Higgsfield `generate_3d` for hero props once credits exist (balance ~0.06 on 2026-11-10; buying is the owner's decision).
* Audio: engine pitch by speed, impacts, item cues, countdown beeps.
* Camera shake and FOV kick on turbo and hits; drift boost (mini-turbo after a long drift).
* Ramps and jump pads (needs 3D or a height field on the track spline).
* Spectator mode after finishing; post-race replay viewer using `ReplayRecorder` data.

### 1b. Mobile / Cafe Bazaar release
* Touch controls, mobile performance pass, Capacitor wrap to a signed AAB/APK, Persian store listing. Full plan and owner blockers in [mobile-release.md](mobile-release.md).

### 1c. Public online multiplayer
* Host the API, game server and Postgres (cheapest reachable VPS), point the public build at it, keep the offline mode as fallback.

### 2. Networking optimisation
* Quantise positions (int16 at 2 cm) and headings (u16): about −35% bandwidth.
* Delta snapshots against the last acked snapshot.
* Extrapolate remote cars near the local player; predict obstacle motion.
* Server rewind (lag compensation) for projectile hits.
* Snapshot divisor 2 for spectators / low-bandwidth clients.

### 3. Anti-cheat improvements
* Behavioural models on telemetry (reaction times, input entropy, steering smoothness) → suspicion points.
* Independent replay verifier service for every prize match.
* Admin review UI with replay playback.
* Device/IP heuristics, account age, and trust score for matchmaking.
* EdDSA tokens (API signs, game servers verify only).

### 4. Additional maps
* Track editor (control points → `TrackDefinition`) with validation (min curvature radius, clearance) already covered by tests.
* 2–3 more circuits, each with its own decoration set.

### 5. Matchmaking
* Skill rating (Glicko-2 or TrueSkill) from verified results; regional queues; party join.
* Multi-process scaling with Redis presence/driver; region-aware room placement.

### 6. Tournament system
* Tournament entity, brackets and schedule; **no bots** and **verified-only** rules enforced.
* Dispute window, payout plan (`planPayouts`), admin approval.

### 7. Web3 / payments
* Phase 2: SIWE wallet sign-in (`players.wallet_address` is ready).
* Phase 3: `TournamentEscrow` on Base Sepolia, EIP-712 result signer in KMS, indexer, `EscrowSettlement` adapter.
* Legal review **before** any real-money tournament (see [06-web3.md](system-design/06-web3.md)).
