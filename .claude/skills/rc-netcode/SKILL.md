---
name: rc-netcode
description: Change the Garage Rumble wire protocol, snapshot format, client prediction, interpolation, tick/snapshot rates or reconnection. Use whenever touching packages/shared/src/protocol.ts, CarPredictor, SnapshotInterpolator, Connection, or RaceRoom message handling.
---

# rc-netcode

Read `docs/system-design/02-networking.md` first.

## Invariants
* Client→server: only `INPUT` (bytes: u16 seq LE, u8 buttons) and `PONG` (JSON echo). Never add state-carrying client messages.
* Server consumes **one input per player per tick** (`MatchSession.step` → `InputGuard.take`). If none arrived, the last buttons are held. Disconnected = 0.
* Snapshots are encoded once per tick (`encodeSnapshot`); per-client only `withSnapshotAck` patches bytes 10–11.
* `RaceSimulation` is deterministic: no wall clock, no `Math.random`.

## Adding a snapshot field
1. `CarSnapshot` (or projectile) in `protocol.ts`; update `CAR_BYTES` and keep encode and decode in the **same order**.
2. Fill it in `RaceSimulation.snapshot()`.
3. If prediction needs it, set it in `CarPredictor.reconcile`.
4. Run the `round-trips snapshots` test and update the size table in docs/02-networking.md.
5. Bump `PROTOCOL_VERSION` if old clients could be connected.

## Adding a button (new action)
1. Next free bit in `BTN`; extend `BTN_MASK` (max 8 bits in a u8; beyond that the packet must grow, so update `INPUT_PACKET_BYTES`, `encodeInput`, `decodeInput` and the tests).
2. Handle it in `RaceSimulation` (edge-triggered via `car.lastButtons` if it's a one-shot).
3. If it affects movement, also handle it in `integrateMovement` (shared with prediction).
4. Map keys and gamepad in `apps/client/src/game/input.ts`, plus the help text in `ui/menus.ts`.

## Prediction rules
* `CarPredictor` must call the **same** functions as the server (`integrateMovement`, `PhysicsWorld.moveCar`, `applyWallResponse`) with the same `prevButtons` semantics.
* Reconcile = server state → drop acked → replay pending. Visual smoothing lives in `RaceClient.visualOffset` (decays ~80 ms, snaps above 4 m).
* Other cars are obstacles (`setObstacles`) with the server impulse formula.

## Rates
`TICK_RATE` (env, default 30), `SNAPSHOT_DIVISOR` (default 1), `interpolationDelayMs` (70) in config. Changing them changes bandwidth (≈12 KB/s/player at 30 Hz) — rerun the load test and update docs/testing.md.

## Colyseus 0.18 specifics
Load the `colyseus` skill. Bytes: `room.sendBytes` / `this.onMessageBytes`. Reconnection: `onDrop` → `allowReconnection`, `onReconnect`, `onLeave` = gone. Close codes 4011–4999.
