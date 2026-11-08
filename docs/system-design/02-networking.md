# 02 · Networking and netcode

## Transport

WebSocket via Colyseus 0.18 (`@colyseus/ws-transport`), with a 4 KB maximum payload. Matchmaking is `client.joinOrCreate("race")`. A room holds at most 10 players and locks when the countdown starts, so late joiners get a new room.

## Messages

| Dir | Type | Id | Encoding | Payload |
|---|---|---|---|---|
| C→S | `INPUT` | 1 | bytes (`sendBytes`) | `u16 seq` LE, `u8 buttons` (exactly 3 bytes) |
| C→S | `PONG` | 2 | JSON | `{ t }`, an echo of a server `PING` |
| S→C | `SNAPSHOT` | 10 | bytes | see below |
| S→C | `EVENT` | 11 | JSON | `GameEvent[]` (hits, pickups, laps, jumps…) |
| S→C | `PING` | 12 | JSON | `{ t }` server time; RTT is measured server-side |
| S→C | `WELCOME` | 13 | JSON | slot, tick rate, laps, seat list, config hash |
| S→C | `RESULTS` | 14 | JSON | final verified ranks |
| S→C | `REJECTED` | 15 | JSON | reserved for refused requests |

Every other client message type, including a known type sent in the wrong encoding, is a **protocol violation**. It is counted, scored as `forbidden_message`, and repeated violations get the client kicked with close code `4011`. There is deliberately no message for position, health, score, inventory, rank or "finished".

### Buttons (`BTN`)

| Bit | Name | Keyboard | Gamepad (standard) |
|---|---|---|---|
| 0 | `ACCELERATE` | W / ↑ | RT |
| 1 | `BRAKE` | S / ↓ | LT / B |
| 2 | `STEER_LEFT` | A / ← | stick / d-pad |
| 3 | `STEER_RIGHT` | D / → | stick / d-pad |
| 4 | `HANDBRAKE` | Space / Shift | RB |
| 5 | `USE_ITEM` | E / Enter | X |
| 6 | `FIRE` | F / J | Y / LB |
| 7 | `JUMP` | Q | A |

`USE_ITEM` and `JUMP` are edge-triggered on the server (button newly pressed this tick). `FIRE` is level-triggered and limited by the server cooldown. **Look back (C / R3) is client-only**: it only moves the camera and is never sent.

### Snapshot layout (little-endian)

```text
header (14 B): u8 version · u8 phase · u32 tick · i32 raceTick · u16 ack · u8 cars · u8 projectiles · u8 boxes
boxes: ceil(boxes/8) bytes of availability bits
car (40 B): u8 slot · f32 x,y,heading,vx,vy · f32 z · i16 vz·100 · u8 hp · u16 flags
            · u8 item, ammo, lap, nextGate, rank · u8 turbo, stun, emp, shield, jumpCooldown ticks
projectile (16 B): u16 id · u8 kind · u8 owner · f32 x,y,heading
```

The server encodes each tick **once** and patches only the 2-byte `ack` per recipient (`withSnapshotAck`).

Measured at 30 Hz with 10 cars: about 12 KB/s down and under 0.1 KB/s up per player (see [testing.md](../testing.md)).

## Client prediction and reconciliation (local car)

`CarPredictor` (`packages/game-core/src/predictor.ts`) runs the **same** `integrateMovement` and Rapier wall sweep as the server.

1. Every 33.3 ms the client samples buttons, sends `INPUT(seq)` and applies it locally right away.
2. On each snapshot, it rewinds the local car to the server state, drops inputs with `seq ≤ ack`, and replays the rest.
3. Corrections under 4 m are hidden by decaying a visual offset (`visualOffset`, about 80 ms). Larger ones snap.
4. Other cars are treated as obstacles at their last reported positions, using the server's impulse rule, so bumps are felt immediately.

Rapier is WebAssembly, so wall physics is bit-identical in every browser. The remaining divergence comes from JS `Math.sin/cos` rounding and the obstacle approximation. Both are small and corrected every snapshot.

### Smooth local rendering
Input and prediction run inside the render loop with a fixed-step accumulator: exactly one input per server tick. The local car is drawn between the last two predicted steps using the leftover accumulator as the blend factor, so it moves smoothly at 60/120/144 Hz instead of stepping at 30 Hz. Body roll and pitch use low-pass-filtered acceleration and yaw rate (raw values step at the network rate and would make the car tremble).

## Interpolation (everyone else)

`SnapshotInterpolator` buffers snapshots and renders remote cars and projectiles **70 ms in the past**. That is about 2 snapshots at 30 Hz. Its render clock follows the newest server tick and corrects drift by 10% per frame. If it falls more than 15 ticks behind, it snaps.

## Reconnection

* Server: `onDrop` holds the seat with `allowReconnection(client, RECONNECT_SECONDS)`. While disconnected, the car receives **neutral input**. It coasts, stays solid and can still be hit, so dropping your connection gives no advantage.
* Client: the SDK retries automatically on the same `Room` instance (`onDrop` shows "reconnecting", `onReconnect` resumes). After `RECONNECT_SECONDS` the server calls `onLeave` and the car forfeits (`4003 FAILED_TO_RECONNECT` on the client).
* On reconnect the input queue and replay-protection sequence are reset, so stale inputs are never applied.

## Close codes

Colyseus reserves 4000–4010. Custom codes live in 4011–4999.

| Code | Meaning |
|---|---|
| 4000 | `CONSENTED`, the player left |
| 4003 | `FAILED_TO_RECONNECT` (Colyseus) |
| 4011 | kicked for protocol violations |
| 4012 | duplicate seat (same account already in the match) |
| 4013 | match over, room closing after results |

## Rate limits

| Layer | Limit |
|---|---|
| Transport | `maxMessagesPerSecond = tickRate × 4 + 10`; Colyseus closes the socket above it |
| InputGuard | token bucket: `tickRate × 1.5`/s sustained, burst 30; queue of 6 (oldest dropped) |
| API | 120 req/min per IP and route; guest sign-up 10/min |
