# Game design

## Pillars

1. **Race first, fight second.** Rank comes from track progress; combat only slows rivals down.
2. **Skill, not spend.** Identical cars, server-side item rolls, no paid power. Cosmetics only, later.
3. **Readable chaos.** 10 cars and plenty of weapons, but every threat can be seen and countered (shield, jump, line choice).

## Match

| Setting | Value |
|---|---|
| Players | up to 10 (bots fill casual lobbies) |
| Tracks | 4 maps (below), 1.1–1.3 km, 16–18 checkpoints, width 16 m |
| Laps | 5, or 4 on the longer hilly maps (winning race about 3.8–4.2 min) |
| Countdown | 4 s |
| Finish grace | 30 s after the first finisher |
| Hard limit | 300 s of racing |
| Wreck | at 0 HP: 2 s down, respawn at the last checkpoint with full HP and 1.5 s spawn protection |

## Car (identical for all)

| Stat | Value |
|---|---|
| Top speed | 30 m/s (turbo ×1.3) |
| Acceleration | 15 m/s² (turbo ×1.8) |
| Brake | 34 m/s²; reverse 9 m/s |
| Max yaw | 2.6 rad/s (drift ×1.45, at 0.94× speed) |
| Health | 100 |
| Handbrake | 9 m/s² (brake is 34), rear grip 1.4 (normal 9): the car slides |
| Jump | 9.6 m/s take-off, 22 m/s² gravity, apex about 2.1 m, about 0.87 s in the air, 1.3 s cooldown |
| Collision | 1.3 m radius, 1.0 m body height; bumps with restitution 0.6 |

### Handbrake drift (Space)

Separate from the brake. It locks the rear: gentle deceleration, almost no sideways grip, and stronger yaw. Flick it to rotate into a hairpin. Release it while holding **throttle + steer** to keep the power slide going until the sideways speed is gone.

### Jump (default ability, Q)

Every car can jump. In the air: no throttle or brake, 30% steering, no tyre grip (momentum carries), 5% speed lost on landing. **Bolts and rockets pass underneath, mines don't trigger, and you clear another car with room to spare** (apex 2.1 m vs a 1.0 m body). Edge-triggered with a cooldown, so it can't be spammed.

## Maps

All maps are toy-scale rooms. **There is no asphalt road anywhere**: the racing surface is the toy track, the rug or the tiles themselves.

| Map | Setting | Laps | Terrain |
|---|---|---|---|
| Toy Track Classic | orange plastic toy track on a wooden playroom floor | 5 | flat, one jump ramp |
| Living Room Rug | round and over a patterned rug, toy-block walls | 5 | rolling hills up to 5 m (cushions under the rug), two book ramps |
| Kitchen Tiles | ceramic floor tiles between table legs and the fridge | 4 | two water spills, a raised serving tray, two cutting-board ramps |
| Toy Track Canyon | blue toy track on yellow stands over a carpet | 4 | climbs to 12 m and plunges down, a splash through a water tray, two ramps |

### Terrain rules (server-simulated, identical in prediction)
* **Slopes:** uphill costs speed, downhill adds it (0.6 × g × grade), always under the speed cap.
* **Water:** top speed ×0.7, grip ×0.55, extra drag. Slippery and slow.
* **Ramps:** a grounded car crossing a ramp lip at ≥ 12 m/s launches at 7 m/s (lower than a jump). It uses the same air rules as a jump.

## Weapons and items

| Item | Effect | Counter |
|---|---|---|
| **Zapper** (always, F) | bolt 75 m/s, 8 dmg, slows 10%; 0.5 s cooldown; 10 ammo refilled each lap | jump, shield |
| **Rocket** | homes on the car directly ahead (follows the track when out of sight), 35 dmg, 1 s stun, knockback | jump at the right moment, shield, walls break line of sight |
| **Mine** | dropped behind, arms in 0.5 s, 25 dmg, 0.7 s stun; max 3 per player; lasts 30 s | jump over, steer around |
| **Shield** | 4 s immunity to damage and EMP | wait it out |
| **Turbo** | 2.5 s of +30% top speed, +80% acceleration | knock them with a mine or bump |
| **EMP** | car directly ahead within 160 m: 1.6 s at 60% throttle and 50% steering, 3 s item lock, cancels turbo; refused (item kept) without a target | shield |
| **Repair** | +35 HP (not rolled above 90% HP) | — |

Item boxes: 4 rows of 4, respawn after 6 s, one held item at a time. Rolls are **rank-weighted**: leaders get mines, shields and repairs; the back of the pack gets rockets, turbo and EMP. This is a comeback mechanic that is the same for everyone and comes from a seeded RNG, so no one can buy or predict it.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake | W / S (↑ / ↓) | RT / LT (B) |
| Steer | A / D (← / →) | left stick or d-pad |
| Handbrake / drift | Space (Shift) | RB |
| Jump | Q | A |
| Look back | C | R3 |
| Fire zapper | F (J) | Y / LB |
| Use item | E (Enter) | X |

## Balance notes (from headless 10-bot races)

* Full race: 250 s for the last finisher, all bots finish.
* About 320 hits and 20 wrecks per race: combat matters but doesn't dominate.
* Zero anti-cheat anomalies across seeds, which is a hard requirement for every balance change (`headless-race.ts`).
