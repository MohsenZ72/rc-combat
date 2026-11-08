# Game design

## Pillars

1. **Race first, fight second.** Rank comes from track progress; combat only slows rivals down.
2. **Skill, not spend.** Identical cars, server-side item rolls, no paid power. Cosmetics only, later.
3. **Readable chaos.** 10 cars and plenty of weapons, but every threat can be seen and countered (shield, jump, line choice).

## Match

| Setting | Value |
|---|---|
| Players | up to 10 (bots fill casual lobbies) |
| Track | Workshop Circuit, about 1.1 km, 16 checkpoints, width 16 m |
| Laps | 5 (winning race about 3.8–4.2 min) |
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
| Jump | 7.5 m/s take-off, 22 m/s² gravity, apex about 1.2 m, about 0.7 s in the air, 1.1 s cooldown |
| Collision | 1.3 m radius; bumps with restitution 0.6; can hop over a car |

### Jump (default ability)

Every car can jump: Space or gamepad A. In the air: no throttle or brake, 30% steering, no tyre grip (momentum carries), 5% speed lost on landing. **Bolts and rockets pass underneath, mines don't trigger, and you can clear another car.** It is a skill dodge with a cooldown, so it can't be spammed.

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
| Drift | Shift | RB |
| Jump | Space | A |
| Fire zapper | F (J) | Y / LB |
| Use item | E (Enter) | X |

## Balance notes (from headless 10-bot races)

* Full race: 250 s for the last finisher, all bots finish.
* About 320 hits and 20 wrecks per race: combat matters but doesn't dominate.
* Zero anti-cheat anomalies across seeds, which is a hard requirement for every balance change (`headless-race.ts`).
