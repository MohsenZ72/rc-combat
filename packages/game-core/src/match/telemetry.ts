import type { GameEvent, PlayerTelemetry } from "@rc/shared";
import { speedOf, type CarState } from "../car.js";

/** Server-side per-player telemetry for anti-cheat review and tuning. */
export class TelemetryCollector {
  private speedSum = 0;
  private prevSpeed = 0;
  private prevHeading = 0;
  private prevX = 0;
  private prevY = 0;
  private started = false;
  readonly data: PlayerTelemetry = {
    ticks: 0,
    avgSpeed: 0,
    maxSpeed: 0,
    maxAcceleration: 0,
    maxYawRate: 0,
    distance: 0,
    inputsReceived: 0,
    inputsDropped: 0,
    inputsRejected: 0,
    packetIntervalMeanMs: 0,
    packetIntervalJitterMs: 0,
    pingMs: 0,
    pingMaxMs: 0,
    itemsPicked: 0,
    itemsUsed: 0,
    shotsFired: 0,
    damageDealt: 0,
    damageTaken: 0,
    wallCollisions: 0,
    carCollisions: 0,
    wrecks: 0,
    disconnects: 0,
    reconnects: 0,
  };

  constructor(private readonly slot: number, private readonly dt: number) {}

  sample(car: CarState): void {
    const speed = speedOf(car);
    if (this.started && !car.respawnedThisTick) {
      const d = this.data;
      d.ticks++;
      this.speedSum += speed;
      d.avgSpeed = this.speedSum / d.ticks;
      d.maxSpeed = Math.max(d.maxSpeed, speed);
      if (!car.impulseThisTick) d.maxAcceleration = Math.max(d.maxAcceleration, (speed - this.prevSpeed) / this.dt);
      let dh = car.heading - this.prevHeading;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      d.maxYawRate = Math.max(d.maxYawRate, Math.abs(dh) / this.dt);
      d.distance += Math.hypot(car.x - this.prevX, car.y - this.prevY);
    }
    this.started = true;
    this.prevSpeed = speed;
    this.prevHeading = car.heading;
    this.prevX = car.x;
    this.prevY = car.y;
  }

  event(e: GameEvent): void {
    const d = this.data;
    switch (e.type) {
      case "pickup":
        if (e.slot === this.slot) d.itemsPicked++;
        break;
      case "item_used":
        if (e.slot === this.slot) d.itemsUsed++;
        break;
      case "fire":
        if (e.slot === this.slot) d.shotsFired++;
        break;
      case "hit":
        if (e.attacker === this.slot && e.victim !== this.slot) d.damageDealt += e.damage;
        if (e.victim === this.slot) d.damageTaken += e.damage;
        break;
      case "collision":
        if (e.slot === this.slot || e.other === this.slot) {
          if (e.other === "wall") d.wallCollisions++;
          else d.carCollisions++;
        }
        break;
      case "wreck":
        if (e.slot === this.slot) d.wrecks++;
        break;
      default:
        break;
    }
  }
}
