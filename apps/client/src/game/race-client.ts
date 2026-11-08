import { CarPredictor, lerpAngle, loadRapier, Track, TRACKS, WORKSHOP_CIRCUIT } from "@rc/game-core";
import { CAR_FLAG, DEFAULT_CONFIG, ITEM_NAMES, mergeConfig, Phase, type CarSnapshot, type Cosmetics, type GameConfig, type GameEvent, type Snapshot } from "@rc/shared";
import { Connection, type LobbyState, type ResultsMessage, type SeatInfo, type Welcome } from "../net/connection.js";
import type { ParticleSystem, Texture } from "@babylonjs/core";
import { CarView, CarViews } from "../render/cars.js";
import { flareTexture, trail } from "../render/fx/particles.js";
import { Effects } from "../render/effects.js";
import { toWorld, World } from "../render/world.js";
import { Vector3 } from "@babylonjs/core";
import type { HudScreen } from "../ui/hud.js";
import { Emitter } from "./emitter.js";
import { InputController } from "./input.js";
import { SnapshotInterpolator } from "./interpolation.js";

interface Pose3 {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Body roll and pitch from impacts (rad). */
  roll: number;
  pitch: number;
}

const poseOf = (s: { x: number; y: number; z: number; heading: number; roll: number; pitch: number }): Pose3 => ({
  x: s.x, y: s.y, z: s.z, heading: s.heading, roll: s.roll, pitch: s.pitch,
});

/** Car body proportions for tilting about the centre of mass (2.6 m × 1.5 m footprint). */
const BODY_HALF_LENGTH = 1.3;
const BODY_HALF_WIDTH = 0.75;
const BODY_CENTRE_HEIGHT = 0.42;

/**
 * Where to put a car's root (pivot on the floor) so the body rolls and pitches
 * about its centre of mass and never sinks into the floor.
 * Roll + = roof towards the car's left; pitch + = nose up.
 */
function tiltOffset(heading: number, roll: number, pitch: number): { dx: number; dy: number; lift: number } {
  const c = BODY_CENTRE_HEIGHT;
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  // Rotating about the floor pivot swings the centre sideways/backwards: move the pivot to cancel it.
  const side = -c * sr;
  const back = c * sp;
  const lift = c * (1 - cr * cp) + Math.max(0, BODY_HALF_WIDTH * Math.abs(sr) + c * Math.abs(cr) - c, BODY_HALF_LENGTH * Math.abs(sp) + c * Math.abs(cp) - c);
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  return { dx: -fy * side + fx * back, dy: fx * side + fy * back, lift };
}

type ClientEvents = {
  lobby: LobbyState;
  welcome: Welcome;
  racing: void;
  results: ResultsMessage;
  connection: "connected" | "reconnecting" | "closed";
  closed: { code: number; reason?: string };
};

/**
 * Client-side match orchestrator: wires network ↔ prediction ↔ rendering ↔ HUD.
 * Holds no authority; everything it shows comes from (or is reconciled to)
 * server snapshots.
 */
export class RaceClient extends Emitter<ClientEvents> {
  /** Current map; replaced when a match on another track starts. */
  track: Track;
  private readonly tracks = new Map<string, Track>();
  private readonly world: World;
  private readonly cars: CarViews;
  private fx: Effects;
  /** Per-car continuous effects: tyre smoke while drifting, spray in water. */
  private carFx = new Map<number, { drift: ParticleSystem; spray: ParticleSystem }>();
  private flareTex: Texture | null = null;
  /** Track segment hint per car for fast ground-height lookups. */
  private groundHints = new Map<number, number>();
  private readonly net = new Connection();
  private readonly input = new InputController();
  private config: GameConfig = DEFAULT_CONFIG;
  private predictor: CarPredictor | null = null;
  private interp: SnapshotInterpolator;
  private hud: HudScreen | null = null;
  private seats = new Map<number, SeatInfo>();
  private mySlot = -1;
  private phase: Phase = Phase.Lobby;
  private latest: Snapshot | null = null;
  private seq = 0;
  private inputActive = false;
  private inputAccumulator = 0;
  private lastFrame = performance.now();
  private visualOffset = { x: 0, y: 0 };
  private tags = new Map<number, HTMLElement>();
  /** Previous rendered heading per car, to derive yaw rate for steering/lean visuals. */
  private headings = new Map<number, number>();
  private lastMapDraw = 0;
  private cameraSnapped = false;
  private lookingBack = false;
  /** Predicted pose before/after the latest 30 Hz step; rendering blends between them. */
  private predPrev: Pose3 | null = null;
  private predCurr: Pose3 | null = null;
  private readonly reportedErrors = new Set<string>();

  private constructor(canvas: HTMLCanvasElement, rapier: Awaited<ReturnType<typeof loadRapier>>) {
    super();
    this.track = this.trackFor(WORKSHOP_CIRCUIT.id);
    this.world = new World(canvas);
    this.world.setTrack(this.track);
    this.cars = new CarViews(this.world, this.world.scene);
    this.fx = new Effects(this.world.scene, this.track);
    this.fx.onExplosion = (x, z, power) => this.onExplosion(x, z, power);
    this.interp = new SnapshotInterpolator(this.config.net.tickRate, this.config.net.interpolationDelayMs);
    this.rapier = rapier;
    this.world.engine.runRenderLoop(() => {
      try {
        this.frame();
      } catch (err) {
        // One bad frame must not stop rendering; report once per message.
        const msg = (err as Error).message;
        if (!this.reportedErrors.has(msg)) {
          this.reportedErrors.add(msg);
          console.error("render frame failed", err);
        }
      }
    });
  }

  private readonly rapier: Awaited<ReturnType<typeof loadRapier>>;

  static async create(canvas: HTMLCanvasElement): Promise<RaceClient> {
    return new RaceClient(canvas, await loadRapier());
  }

  attachHud(hud: HudScreen | null): void {
    this.hud = hud;
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
  }

  async join(token: string, track = "any"): Promise<void> {
    this.resetMatch();
    this.net.clear();
    this.net.on("welcome", (w) => this.onWelcome(w));
    this.net.on("lobby", (l) => this.emit("lobby", l));
    this.net.on("snapshot", (s) => this.onSnapshot(s));
    this.net.on("events", (e) => this.onEvents(e));
    this.net.on("results", (r) => {
      this.stopInput();
      this.emit("results", r);
    });
    this.net.on("connection", (c) => this.emit("connection", c));
    this.net.on("closed", (c) => {
      this.stopInput();
      this.emit("closed", c);
    });
    await this.net.join(token, track);
  }

  async leave(): Promise<void> {
    this.stopInput();
    await this.net.leave();
    this.resetMatch();
  }

  private garageCar: CarView | null = null;
  private garageAngle = 0;

  /** Shows a turntable preview of a loadout (garage screen). Rebuilds when called again. */
  showGarage(cosmetics: Cosmetics): void {
    this.garageCar?.dispose();
    this.garageCar = new CarView(this.world, `garage-${Date.now()}`, cosmetics);
  }

  closeGarage(): void {
    this.garageCar?.dispose();
    this.garageCar = null;
  }

  /** Debug snapshot of client-side state (used by the dev console handle). */
  debug() {
    return {
      slot: this.mySlot,
      phase: this.phase,
      seq: this.seq,
      latestTick: this.latest?.tick,
      ack: this.latest?.ack,
      me: this.latest?.cars.find((c) => c.slot === this.mySlot),
      predicted: this.predictor?.ready ? { ...this.predictor.state } : null,
      renderTick: this.interp.tick,
      inputs: this.input.sample(),
    };
  }

  get slot(): number {
    return this.mySlot;
  }

  // ------------------------------------------------------------ network handlers

  private trackFor(id: string): Track {
    let t = this.tracks.get(id);
    if (!t) {
      const def = TRACKS[id] ?? TRACKS[WORKSHOP_CIRCUIT.id]!;
      t = new Track(def);
      this.tracks.set(id, t);
    }
    return t;
  }

  private onWelcome(w: Welcome): void {
    this.mySlot = w.slot;
    const track = this.trackFor(w.trackId);
    if (track !== this.track) {
      this.track = track;
      this.world.setTrack(track);
      this.fx.dispose();
      this.fx = new Effects(this.world.scene, track);
      this.fx.onExplosion = (x, z, power) => this.onExplosion(x, z, power);
      this.groundHints.clear();
    }
    this.seats = new Map(w.seats.map((s) => [s.slot, s]));
    // Mirror the server's tick parameters so prediction integrates identically.
    this.config = mergeConfig(DEFAULT_CONFIG, { net: { tickRate: w.tickRate, snapshotDivisor: w.snapshotDivisor }, race: { laps: w.laps } });
    this.interp = new SnapshotInterpolator(this.config.net.tickRate, this.config.net.interpolationDelayMs);
    this.predictor?.dispose();
    this.predictor = new CarPredictor(this.rapier, this.track, this.config, w.slot);
    for (const s of w.seats) this.cars.ensure(s.slot, s.cosmetics);
    this.cars.retain(new Set(w.seats.map((s) => s.slot)));
    this.emit("welcome", w);
  }

  private onSnapshot(s: Snapshot): void {
    const now = performance.now();
    const prevPhase = this.phase;
    this.latest = s;
    this.phase = s.phase;
    this.interp.push(s, now);
    const me = s.cars.find((c) => c.slot === this.mySlot);
    if (me && this.predictor) {
      const before = this.predictor.ready ? { x: this.predictor.state.x, y: this.predictor.state.y } : null;
      this.predictor.reconcile(me, s.ack, s.phase === Phase.Racing);
      // Hide small corrections by blending them out visually over a few frames.
      if (before) {
        const dx = before.x - this.predictor.state.x;
        const dy = before.y - this.predictor.state.y;
        if (Math.hypot(dx, dy) < 4) {
          this.visualOffset.x += dx;
          this.visualOffset.y += dy;
          // Shift the interpolation endpoints by the correction too, so the blend stays continuous.
          if (this.predPrev) {
            this.predPrev.x -= dx;
            this.predPrev.y -= dy;
          }
        } else {
          this.visualOffset = { x: 0, y: 0 };
          this.predPrev = null;
        }
      }
      this.predCurr = poseOf(this.predictor.state);
      this.predPrev ??= { ...this.predCurr };
      this.updateHud(me, s);
      // Other cars become obstacles for prediction, so bumps are felt immediately.
      this.predictor.setObstacles(
        s.cars.filter((c) => c.slot !== this.mySlot && (c.flags & (CAR_FLAG.FINISHED | CAR_FLAG.WRECKED)) === 0),
      );
    }
    if (prevPhase !== s.phase && (s.phase === Phase.Countdown || s.phase === Phase.Racing)) this.startInput();
    if (s.phase === Phase.Racing && prevPhase !== Phase.Racing) this.emit("racing", undefined);
    this.fx.setBoxes(s.boxes, now);
  }

  private onEvents(events: GameEvent[]): void {
    const name = (slot: number) => this.seats.get(slot)?.nickname ?? `Car ${slot + 1}`;
    for (const e of events) {
      switch (e.type) {
        case "countdown":
          this.hud?.show(String(e.secondsLeft), "", 900);
          break;
        case "race_start":
          this.hud?.show("GO!", "is-go", 900);
          break;
        case "hit": {
          if (!e.blocked) this.cars.get(e.victim)?.flash(performance.now());
          const v = this.cars.get(e.victim)?.root.position;
          if (v) {
            if (e.source === "emp") this.fx.burst("electric", v.x, v.y + 1, v.z, 1.4);
            else if (e.source === "bolt") this.fx.burst("sparks", v.x, v.y + 0.8, v.z, 1);
            if (e.blocked) this.fx.burst("electric", v.x, v.y + 1, v.z, 0.8);
          }
          if (e.source !== "bolt" && (e.victim === this.mySlot || e.attacker === this.mySlot)) {
            this.hud?.pushFeed(e.blocked ? `${name(e.victim)} blocked ${name(e.attacker)}'s ${e.source}` : `${name(e.attacker)} hit ${name(e.victim)} with ${e.source}`);
          }
          break;
        }
        case "item_used": {
          const p = this.cars.get(e.slot)?.root.position;
          if (p && e.item === 6) this.fx.burst("heal", p.x, p.y + 1, p.z, 1.3);
          break;
        }
        case "wreck": {
          const p = this.cars.get(e.slot)?.root.position;
          if (p) this.fx.explode(p.x, p.y + 0.8, p.z, 1.6);
        }
          this.hud?.pushFeed(e.by === null ? `${name(e.slot)} wrecked` : `${name(e.by)} wrecked ${name(e.slot)}`);
          if (e.slot === this.mySlot) this.hud?.show("Wrecked!", "is-warn", 1500);
          break;
        case "lap":
          if (e.slot === this.mySlot && e.lap < this.config.race.laps) this.hud?.show(`Lap ${e.lap + 1}`, "", 1200);
          break;
        case "finish":
          this.hud?.pushFeed(`${name(e.slot)} finished ${e.rank}`, true);
          if (e.slot === this.mySlot) this.hud?.show("Finish!", "is-go", 2500);
          break;
        case "pickup":
          if (e.slot === this.mySlot) this.hud?.pushFeed(`Got ${ITEM_NAMES[e.item]}`, true);
          break;
        case "jump":
          break;
        case "collision": {
          // Sparks where it hurts: hard bumps and wall hits.
          if (e.impulse < 6) break;
          const p = this.cars.get(e.slot)?.root.position;
          if (p) this.fx.burst("sparks", p.x, p.y + 0.5, p.z, Math.min(2, e.impulse / 10));
          break;
        }
        case "item_rejected":
          if (e.reason === "no_target") this.hud?.pushFeed("No target in range", true);
          break;
        case "forfeit":
          this.hud?.pushFeed(`${name(e.slot)} left the race`, true);
          break;
        default:
          break;
      }
    }
  }

  private updateHud(me: CarSnapshot, s: Snapshot): void {
    if (!this.hud) return;
    this.hud.update({
      rank: me.rank,
      total: s.cars.length,
      lap: me.lap,
      laps: this.config.race.laps,
      hp: me.hp,
      maxHp: this.config.car.maxHealth,
      item: me.item,
      itemLocked: (me.flags & CAR_FLAG.ITEM_LOCKED) !== 0,
      ammo: me.ammo,
      maxAmmo: this.config.items.bolt.maxAmmo,
      shield: (me.flags & (CAR_FLAG.SHIELD | CAR_FLAG.SPAWN_PROTECTED)) !== 0,
      turbo: (me.flags & CAR_FLAG.TURBO) !== 0,
      emp: (me.flags & CAR_FLAG.EMP) !== 0,
      wrongWay: (me.flags & CAR_FLAG.WRONG_WAY) !== 0,
    });
    this.hud.setTimer(Math.max(0, (s.raceTick * 1000) / this.config.net.tickRate));
  }

  // ------------------------------------------------------------ input loop

  private startInput(): void {
    if (this.inputActive) return;
    this.input.attach();
    this.inputActive = true;
    this.inputAccumulator = 0;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private stopInput(): void {
    this.inputActive = false;
    this.input.detach();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** A hidden tab stops rendering (and therefore input); tell the server we let go of everything. */
  private readonly onVisibility = () => {
    if (document.hidden && this.inputActive) {
      this.seq = (this.seq + 1) & 0xffff;
      this.net.sendInput(this.seq, 0);
    }
  };

  /**
   * Fixed-step input + prediction driven by the render loop: exactly one input per server
   * tick, and the leftover accumulator gives the blend factor for this frame.
   */
  private stepInput(frameMs: number): number {
    if (!this.inputActive) return 1;
    const tickMs = 1000 / this.config.net.tickRate;
    this.inputAccumulator += frameMs;
    let steps = 0;
    while (this.inputAccumulator >= tickMs && steps < 4) {
      this.inputAccumulator -= tickMs;
      steps++;
      const buttons = this.input.sample();
      this.seq = (this.seq + 1) & 0xffff;
      this.net.sendInput(this.seq, buttons);
      this.predictor?.applyInput(this.seq, buttons, this.phase === Phase.Racing);
      if (this.predictor?.ready) {
        this.predPrev = this.predCurr ?? poseOf(this.predictor.state);
        this.predCurr = poseOf(this.predictor.state);
      }
    }
    if (this.inputAccumulator > tickMs * 4) this.inputAccumulator = 0;
    return this.inputAccumulator / tickMs;
  }

  // ------------------------------------------------------------ render loop

  private frame(): void {
    const now = performance.now();
    const frameMs = Math.min(100, now - this.lastFrame);
    const dt = frameMs / 1000;
    this.lastFrame = now;
    const predictAlpha = this.stepInput(frameMs);
    this.interp.advance(now, frameMs);
    const decay = Math.exp(-dt * 12);
    this.visualOffset.x *= decay;
    this.visualOffset.y *= decay;

    const remote = this.interp.cars();
    const visible = new Set<number>();
    const mapDots: { x: number; y: number; color: string; me: boolean }[] = [];
    for (const c of remote) {
      visible.add(c.slot);
      const view = this.cars.ensure(c.slot);
      let x = c.x;
      let y = c.y;
      let z = c.z;
      let heading = c.heading;
      let vx = c.vx;
      let vy = c.vy;
      let roll = c.roll;
      let pitch = c.pitch;
      if (c.slot === this.mySlot && this.predictor?.ready) {
        const p = this.predictor.state;
        // Blend between the last two 30 Hz prediction steps so the car moves smoothly at any frame rate.
        const a = this.predPrev ?? poseOf(p);
        const b = this.predCurr ?? poseOf(p);
        const alpha = predictAlpha;
        x = a.x + (b.x - a.x) * alpha + this.visualOffset.x;
        y = a.y + (b.y - a.y) * alpha + this.visualOffset.y;
        z = a.z + (b.z - a.z) * alpha;
        heading = lerpAngle(a.heading, b.heading, alpha);
        roll = lerpAngle(a.roll, b.roll, alpha);
        pitch = a.pitch + (b.pitch - a.pitch) * alpha;
        vx = p.vx;
        vy = p.vy;
        // C (or R3) flips the chase camera to look behind; snap on toggle so it doesn't swing through the car.
        const lookBack = this.input.lookingBack();
        this.world.follow(x, y, this.groundHeight(c.slot, x, y) + z, heading + (lookBack ? Math.PI : 0), Math.hypot(vx, vy), dt, !this.cameraSnapped || lookBack !== this.lookingBack);
        this.lookingBack = lookBack;
        this.cameraSnapped = true;
      }
      const forwardSpeed = vx * Math.cos(heading) + vy * Math.sin(heading);
      const prevHeading = this.headings.get(c.slot) ?? heading;
      let dh = heading - prevHeading;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      this.headings.set(c.slot, heading);
      const yawRate = dt > 0 ? dh / dt : 0;
      const ground = this.groundHeight(c.slot, x, y);
      // Impact tilt: the whole car rolls/pitches about its centre of mass (a flip is a full roll).
      const tilt = tiltOffset(heading, roll, pitch);
      view.update(x + tilt.dx, y + tilt.dy, ground + z + tilt.lift, heading, forwardSpeed, yawRate, c.flags, dt, now);
      view.root.rotation.x = roll;
      view.root.rotation.z += pitch;
      this.carEffects(c.slot, x, y, ground, z, heading, Math.abs(forwardSpeed), c.flags);
      mapDots.push({ x, y, color: this.seats.get(c.slot)?.color ?? "#ccc", me: c.slot === this.mySlot });
      this.placeTag(c.slot, x, y);
    }
    if (remote.length > 0) this.cars.retain(visible);
    if (this.garageCar) {
      // Turntable in front of the start line, camera close and low like a product shot.
      this.garageAngle += dt * 0.5;
      const pose = this.track.poseAt(20);
      const h = this.track.heightAt(20);
      this.garageCar.showcase(pose.x, pose.y, h, this.garageAngle);
      this.world.lookAt(pose.x, pose.y, h + 0.6, 6.6, 2.3, -0.9);
    } else if (!this.cameraSnapped) this.world.orbit(now / 1000);
    this.fx.sync(this.interp.projectiles(), now);
    this.fx.update(dt);
    if (this.hud && now - this.lastMapDraw > 100) {
      this.hud.drawMap(mapDots);
      this.lastMapDraw = now;
    }
    this.world.scene.render();
  }

  /** Tyre smoke while drifting and water spray in puddles, emitted from behind the rear wheels. */
  private carEffects(slot: number, x: number, y: number, ground: number, z: number, heading: number, speed: number, flags: number): void {
    let fx = this.carFx.get(slot);
    if (!fx) {
      this.flareTex ??= flareTexture(this.world.scene);
      fx = { drift: trail(this.world.scene, this.flareTex, "drift"), spray: trail(this.world.scene, this.flareTex, "spray") };
      fx.drift.start();
      fx.spray.start();
      this.carFx.set(slot, fx);
    }
    const rearX = x - Math.cos(heading) * 1.1;
    const rearY = y - Math.sin(heading) * 1.1;
    const pos = toWorld(rearX, rearY, ground + 0.2);
    (fx.drift.emitter as Vector3).copyFrom(pos);
    (fx.spray.emitter as Vector3).copyFrom(pos);
    const onGround = z <= 0.01 && (flags & CAR_FLAG.WRECKED) === 0;
    const drifting = (flags & CAR_FLAG.DRIFTING) !== 0;
    fx.drift.emitRate = onGround && drifting && speed > 6 ? 70 : 0;
    const inWater = onGround && this.track.waterAt(this.track.project(x, y, this.groundHints.get(slot) ?? -1).s);
    fx.spray.emitRate = inWater && speed > 4 ? 40 + speed * 3 : 0;
  }

  private onExplosion(x: number, z: number, power: number): void {
    const me = this.cars.get(this.mySlot)?.root.position;
    if (!me) return;
    const d = Math.hypot(me.x - x, me.z - z);
    if (d < 30) this.world.shake(power * (1 - d / 30) * 0.9);
  }

  /** Ground height under a car (hills, ramps' base); cached segment hint keeps it cheap. */
  private groundHeight(slot: number, x: number, y: number): number {
    const g = this.world.groundAt(x, y, this.groundHints.get(slot) ?? -1);
    this.groundHints.set(slot, g.segment);
    return g.h;
  }

  private placeTag(slot: number, x: number, y: number): void {
    if (!this.hud || slot === this.mySlot) return;
    let tag = this.tags.get(slot);
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "nametag";
      tag.textContent = this.seats.get(slot)?.nickname ?? "";
      tag.style.color = this.seats.get(slot)?.color ?? "#fff";
      this.hud.tags.append(tag);
      this.tags.set(slot, tag);
    }
    const p = this.world.project(toWorld(x, y, this.groundHeight(slot, x, y) + 2.4));
    const dist = Math.hypot(this.world.camera.position.x - x, this.world.camera.position.z - y);
    if (!p || dist > 120) {
      tag.style.display = "none";
      return;
    }
    tag.style.display = "";
    tag.style.left = `${p.x}px`;
    tag.style.top = `${p.y}px`;
  }

  private resetMatch(): void {
    this.mySlot = -1;
    this.phase = Phase.Lobby;
    this.latest = null;
    this.seq = 0;
    this.cameraSnapped = false;
    this.visualOffset = { x: 0, y: 0 };
    this.predPrev = null;
    this.predCurr = null;
    this.predictor?.dispose();
    this.predictor = null;
    this.interp = new SnapshotInterpolator(this.config.net.tickRate, this.config.net.interpolationDelayMs);
    this.cars.retain(new Set());
    this.fx.sync([], performance.now());
    for (const fx of this.carFx.values()) {
      fx.drift.dispose();
      fx.spray.dispose();
    }
    this.carFx.clear();
    void this.latest;
  }
}
