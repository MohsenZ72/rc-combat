# 03 · Anti-cheat

## Principle

The browser is hostile. It may send **only button presses**. Position, velocity, steering, collisions, item pickups, weapon use, damage, shields, cooldowns, ammo, checkpoints, laps, rank, finish time, score and the match result are all computed by the server simulation.

So the classic browser cheats (editing memory, patching JS, forging packets to claim a position or a finish) have **no message to forge**. What remains is input manipulation and protocol abuse, which the layers below handle.

## Threat model and coverage

| Cheat / abuse | Prevented by | Where | Test |
|---|---|---|---|
| Teleport / set own position | No such message; movement validator against the last validated state; revert | `movement-validator.ts`, `simulation.ts › validate` | `rejects and reverts a teleport`, `corrects corrupted state inside the live simulation` |
| Speed hack (fake speed) | No such message; integrator hard cap; validator speed check | `vehicle.ts`, validator | `rejects and corrects a speed hack` |
| Speed hack by **input flooding** | One input per tick, token bucket, bounded queue | `input-guard.ts`, `match-session.ts › step` | `speed hack by input flooding gains no distance` |
| Impossible acceleration / rotation | Validator acceleration and yaw limits | validator | `rejects impossible acceleration/rotation` |
| Wall clipping / out of bounds | Rapier sweep (no tunnelling) + lateral bounds check, then respawn | `physics.ts`, validator | `walls stop a car…`, `detects wall clipping…` |
| Checkpoint skipping / shortcuts | Ordered gates; forward crossing of a gate *ahead* = `checkpoint_skip`; progress capped to confirmed gates | `race.ts` | `rejects a skipped checkpoint` |
| Reverse-route / finish-line farming | Only the expected gate counts; laps need all gates | `race.ts` | `does not count a lap from crossing the finish line back and forth` |
| Fake finish / score / health / rank | No message type exists; any other type is `forbidden_message`, then kick | `race-room.ts`, `match-session.ts` | `fake finish / score / health…` (core + server) |
| Item duplication / using items not owned | Server-owned inventory; edge-triggered use; one item slot; box only gives to empty slot | `simulation.ts › tryUseItem`, `updateBoxes` | `rejects using an item…`, `…does not duplicate items`, `…only once` |
| Fire-rate hacks | Cooldown and ammo counted in server ticks | `simulation.ts › tryFire` | `3 s cooldown never allows a shot after 0.2 s`, `holding FIRE cannot exceed…` |
| Invalid targets (EMP with no one ahead) | Target chosen server-side; refused and the item kept | `tryUseItem` | `EMP without a valid target is refused…` |
| Fly / double jump / super jump | Jump only from the floor with cooldown; validator caps height, take-off speed, and mid-air lift | `vehicle.ts`, validator | `jump.test.ts` |
| Replayed / duplicated packets | 16-bit sequence must be newer (wrap-aware) | `input-guard.ts` | `rejects replayed…` |
| Malformed / oversized packets | Strict decoder (exact length and type); 4 KB transport cap | `protocol.ts`, `index.ts` | `rejects malformed packets` |
| Message floods / DoS from one client | Transport message cap, token bucket, violation window, then kick | `race-room.ts` | `kicks a client that keeps sending garbage` |
| Fake ping | RTT measured from server timestamps; unknown echoes ignored | `match-session.ts › onPong` | `pong echoes the server cannot have sent are ignored` |
| Disconnect abuse (rage-quit, lag switch) | Disconnected car gets neutral input, stays solid and hittable; leaving = forfeit, ranked last | `match-session.ts` | `a dropped player coasts…`, `…leaves mid-race forfeits…` |
| Multi-seating one account | One seat per account per match (room + DB unique index) | `race-room.ts › onJoin`, migration | `rejects a second seat…` |
| Forged results to the API | Internal key; result must match the registered server, seed, config hash and roster; ranks unique; idempotent | `matches.service.ts` | API e2e `rejects a result whose roster differs…` |
| Session theft after a ban | Tokens are bound to session rows; suspension revokes all sessions immediately | `players.repository.ts › suspend` | `suspends a cheater, revokes their sessions…` |

## Layers

1. **Protocol** (`InputGuard`, room wildcard handler). Strict decoding, sequence check, token bucket, bounded queue, violation counting and kicks. Network noise from here is scored as *minor* and decays.
2. **Simulation authority.** The server integrates movement itself, under hard caps (`speedCap`, the absolute ceiling, jump physics).
3. **Movement validator.** Every tick it compares the new state with the previous **validated** state, with tolerance:
   * NaN/∞ → `invalid_state` (respawn)
   * speed above the legal cap (with decay after turbo or knockback) → `speed` (clamp)
   * speed gain above engine power → `acceleration` (clamp), unless an impulse excuses it
   * yaw change above the maximum rate → `rotation` (clamp)
   * distance above `max(speed)·dt + slack` → `teleport` (revert to previous position)
   * height above `v²/2g`, take-off speed too high, lift while airborne → `jump` (clamp)
   * centre beyond the walls → `wall_clip` or `out_of_bounds` (respawn at the last checkpoint)
4. **Race integrity.** Ordered gates, `checkpoint_skip`, and a cap on progress per tick (`progress_jump`).
5. **Suspicion scoring** (`SuspicionTracker`):

| Severity | Kinds | Points | Behaviour |
|---|---|---|---|
| minor | `malformed_packet`, `input_flood`, `replayed_input` | 1 | decays 0.05/s, so bad Wi-Fi never escalates |
| moderate | `forbidden_message`, `speed`, `acceleration`, `rotation` | 5 | permanent within the match |
| major | `teleport`, `wall_clip`, `out_of_bounds`, `checkpoint_skip`, `progress_jump`, `jump`, `invalid_state` | 20 | ×2.5 when repeated within 10 s (20 → 50) |

| Level | Score ≥ | Consequence |
|---|---|---|
| suspicious | 5 | logged |
| flagged | 20 | added to the **manual review queue** (`GET /internal/review-queue`) |
| restricted | 50 | result `verified = false`, so never prize-eligible and excluded from stats |
| match_invalidated | 80 | the whole match becomes `invalidated` |
| temporary_suspension | 150 | account suspended for `SUSPENSION_HOURS`, all sessions revoked |

Permanent bans are **never** automatic. They follow a human review of telemetry and the replay. Every number above lives in `DEFAULT_CONFIG.antiCheat` and can be tuned without code changes.

6. **Telemetry.** Per player: speed (avg/max), max acceleration, max yaw rate, distance, inputs received/dropped/rejected, packet interval mean and jitter, ping (avg/max), items, shots, damage, collisions, wrecks, disconnects/reconnects. Stored in `match_players.telemetry`.
7. **Replays** (`ReplayRecorder`). Applied inputs (run-length), session controls (disconnect/forfeit), 1 Hz keyframes, all events and anti-cheat flags. `verifyReplay` re-simulates and compares keyframes, so a tampered replay or a non-deterministic server is detected (`detects a tampered replay`). Stored gzipped in `replays`.

## Why the validator still matters when clients can't send positions

Because the simulation is authoritative, a violation means one of three things:
1. a physics bug or tunnelling edge case,
2. corrupted server state (an exploit in another system), or
3. a future feature that accepts client-side physics.

The validator turns all three into a scored, logged, corrected event. That is why an honest 10-bot race must produce **zero** anomalies. This is tested (`accepts a full honest 10-bot race with zero anomalies`) and checked in every headless race.

## Not covered yet (needs more work)

| Threat | Why it is hard | Plan |
|---|---|---|
| Input bots / auto-steer / aim-assist | Produce legal button streams | Behavioural models on telemetry (reaction-time distributions, input entropy, superhuman consistency), honeypot challenges, then manual review |
| Collusion / win-trading in prize matches | Legal inputs, coordinated intent | Graph analysis of co-occurrence and damage patterns; one seat per verified identity (KYC) for paid tournaments |
| Multi-accounting / Sybil | Guest accounts are cheap | Wallet + KYC for paid play, device/IP heuristics, rate limits on account creation |
| Lag switching for advantage | Neutral input and full collision already remove most of it | Penalise repeated short disconnects in suspicion scoring |
| Game-server compromise | The server is the authority | Signed results (EIP-712 in phase 3), replay re-verification by an independent verifier service before payout |
| Client tampering for information (wall-hacks) | Clients receive all car positions | Low value in a racing game; area-of-interest filtering possible later |
| DDoS | Network-level | CDN/WAF in front of WSS, per-IP connection caps at the load balancer |
