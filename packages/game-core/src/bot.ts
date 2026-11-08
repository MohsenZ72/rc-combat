import { BTN, ItemKind } from "@rc/shared";
import type { CarState } from "./car.js";
import { speedOf } from "./car.js";
import { angleDelta } from "./math.js";
import { Rng } from "./rng.js";
import type { Track } from "./track.js";

export interface BotView {
  track: Track;
  cars: readonly CarState[];
  tickRate: number;
}

/**
 * Simple racing AI that produces button masks, exactly like a human client.
 * Bots fill empty seats in casual matches and drive the load tests; they go
 * through the same input path and anti-cheat checks as players.
 */
export class BotDriver {
  private readonly rng: Rng;
  private lateral = 0;
  private lateralTarget = 0;
  private stuckTicks = 0;
  private reverseTicks = 0;
  private itemDelay = 0;
  private hint = -1;

  constructor(readonly slot: number, seed: number, private readonly skill = 0.7) {
    this.rng = new Rng(seed ^ (slot * 0x9e3779b1));
    this.lateralTarget = this.rng.range(-3, 3);
  }

  decide(view: BotView): number {
    const car = view.cars[this.slot];
    if (!car || car.forfeited || car.finished) return 0;
    const track = view.track;
    const speed = speedOf(car);
    const proj = track.project(car.x, car.y, this.hint);
    this.hint = proj.segment;

    if (this.rng.next() < 0.01) this.lateralTarget = this.rng.range(-4, 4) * (1 - this.skill * 0.5);
    this.lateral += (this.lateralTarget - this.lateral) * 0.02;

    // Unstick: reverse briefly if we have been crawling for a while.
    if (this.reverseTicks > 0) {
      this.reverseTicks--;
      return BTN.BRAKE | (this.rng.next() < 0.5 ? BTN.STEER_LEFT : BTN.STEER_RIGHT);
    }
    if (speed < 1.5 && car.stunTicks === 0 && car.wreckTicks === 0) this.stuckTicks++;
    else this.stuckTicks = 0;
    if (this.stuckTicks > view.tickRate * 1.5) {
      this.stuckTicks = 0;
      this.reverseTicks = view.tickRate;
    }

    const lookahead = 9 + speed * 0.55;
    const aim = track.poseAt(proj.s + lookahead);
    const lx = -Math.sin(aim.heading);
    const ly = Math.cos(aim.heading);
    const tx = aim.x + lx * this.lateral;
    const ty = aim.y + ly * this.lateral;
    const desired = Math.atan2(ty - car.y, tx - car.x);
    const diff = angleDelta(car.heading, desired);

    // Anticipate corners: how much the track turns over the next stretch.
    const near = track.poseAt(proj.s + 12);
    const far = track.poseAt(proj.s + 12 + speed * 1.4);
    const bend = Math.abs(angleDelta(near.heading, far.heading));

    let buttons = 0;
    if (diff > 0.04) buttons |= BTN.STEER_LEFT;
    else if (diff < -0.04) buttons |= BTN.STEER_RIGHT;
    const cornerSpeed = 30 - bend * (18 + 10 * (1 - this.skill));
    if (Math.abs(diff) > 1.1 && speed > 10) buttons |= BTN.BRAKE;
    else if (speed < cornerSpeed || speed < 12) buttons |= BTN.ACCELERATE;
    if (bend > 0.6 && speed > 18 && Math.abs(diff) > 0.25 && this.skill > 0.5) buttons |= BTN.DRIFT;

    buttons |= this.combat(view, car, speed, bend);
    return buttons;
  }

  private combat(view: BotView, car: CarState, speed: number, bend: number): number {
    let buttons = 0;
    // Primary fire at a car in front of the nose.
    for (const other of view.cars) {
      if (other.slot === car.slot || other.forfeited || other.finished || other.wreckTicks > 0) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const d = Math.hypot(dx, dy);
      if (d > 32 || d < 2) continue;
      const off = Math.abs(angleDelta(car.heading, Math.atan2(dy, dx)));
      if (off < 0.15 && this.rng.next() < 0.12 * this.skill) {
        buttons |= BTN.FIRE;
        break;
      }
    }
    if (car.item === ItemKind.None) {
      this.itemDelay = Math.floor(this.rng.range(0.3, 2.5) * view.tickRate);
      return buttons;
    }
    if (this.itemDelay > 0) {
      this.itemDelay--;
      return buttons;
    }
    const active = view.cars.filter((c) => !c.forfeited).length;
    let use = false;
    switch (car.item) {
      case ItemKind.Rocket:
      case ItemKind.Emp:
        use = car.rank > 1;
        break;
      case ItemKind.Mine:
        use = car.rank < active;
        break;
      case ItemKind.Shield:
        use = car.hp < 65 || this.rng.next() < 0.01;
        break;
      case ItemKind.Turbo:
        use = bend < 0.25 && speed > 12;
        break;
      case ItemKind.Repair:
        use = car.hp < 70;
        break;
      default:
        break;
    }
    // Release the button every other tick so the server sees a fresh press.
    if (use && (car.lastButtons & BTN.USE_ITEM) === 0) buttons |= BTN.USE_ITEM;
    return buttons;
  }
}
