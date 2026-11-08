import { CarPredictor, loadRapier, Track, TRACKS, WORKSHOP_CIRCUIT } from "@rc/game-core";
import { CAR_FLAG, DEFAULT_CONFIG, ITEM_NAMES, mergeConfig, Phase, type CarSnapshot, type GameConfig, type GameEvent, type Snapshot } from "@rc/shared";
import { Connection, type LobbyState, type ResultsMessage, type SeatInfo, type Welcome } from "../net/connection.js";
import { CarViews } from "../render/cars.js";
import { Effects } from "../render/effects.js";
import { toWorld, World } from "../render/world.js";
import type { HudScreen } from "../ui/hud.js";
import { Emitter } from "./emitter.js";
import { InputController } from "./input.js";
import { SnapshotInterpolator } from "./interpolation.js";

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
  readonly track: Track;
  private readonly world: World;
  private readonly cars: CarViews;
  private readonly fx: Effects;
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
  private inputTimer = 0;
  private inputAccumulator = 0;
  private lastInputAt = 0;
  private lastFrame = performance.now();
  private visualOffset = { x: 0, y: 0 };
  private tags = new Map<number, HTMLElement>();
  private lastMapDraw = 0;
  private cameraSnapped = false;
  private readonly reportedErrors = new Set<string>();

  private constructor(canvas: HTMLCanvasElement, rapier: Awaited<ReturnType<typeof loadRapier>>) {
    super();
    this.track = new Track(TRACKS[WORKSHOP_CIRCUIT.id]!);
    this.world = new World(canvas);
    this.world.buildTrack(this.track);
    this.cars = new CarViews(this.world, this.world.scene);
    this.fx = new Effects(this.world.scene, this.track);
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

  async join(token: string): Promise<void> {
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
    await this.net.join(token);
  }

  async leave(): Promise<void> {
    this.stopInput();
    await this.net.leave();
    this.resetMatch();
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

  private onWelcome(w: Welcome): void {
    this.mySlot = w.slot;
    this.seats = new Map(w.seats.map((s) => [s.slot, s]));
    // Mirror the server's tick parameters so prediction integrates identically.
    this.config = mergeConfig(DEFAULT_CONFIG, { net: { tickRate: w.tickRate, snapshotDivisor: w.snapshotDivisor }, race: { laps: w.laps } });
    this.interp = new SnapshotInterpolator(this.config.net.tickRate, this.config.net.interpolationDelayMs);
    this.predictor?.dispose();
    this.predictor = new CarPredictor(this.rapier, this.track, this.config, w.slot);
    for (const s of w.seats) this.cars.ensure(s.slot, s.color);
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
        } else {
          this.visualOffset = { x: 0, y: 0 };
        }
      }
      this.updateHud(me, s);
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
        case "hit":
          if (!e.blocked) this.cars.get(e.victim)?.flash(performance.now());
          if (e.source !== "bolt" && (e.victim === this.mySlot || e.attacker === this.mySlot)) {
            this.hud?.pushFeed(e.blocked ? `${name(e.victim)} blocked ${name(e.attacker)}'s ${e.source}` : `${name(e.attacker)} hit ${name(e.victim)} with ${e.source}`);
          }
          break;
        case "wreck":
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
    if (this.inputTimer) return;
    this.input.attach();
    this.lastInputAt = performance.now();
    this.inputAccumulator = 0;
    const tickMs = 1000 / this.config.net.tickRate;
    // Send exactly one input per server tick; the accumulator absorbs timer drift.
    this.inputTimer = window.setInterval(() => {
      const now = performance.now();
      this.inputAccumulator += now - this.lastInputAt;
      this.lastInputAt = now;
      let sends = 0;
      while (this.inputAccumulator >= tickMs && sends < 3) {
        this.inputAccumulator -= tickMs;
        sends++;
        const buttons = this.input.sample();
        this.seq = (this.seq + 1) & 0xffff;
        this.net.sendInput(this.seq, buttons);
        this.predictor?.applyInput(this.seq, buttons, this.phase === Phase.Racing);
      }
      if (this.inputAccumulator > tickMs * 3) this.inputAccumulator = 0;
    }, tickMs / 2);
  }

  private stopInput(): void {
    if (this.inputTimer) window.clearInterval(this.inputTimer);
    this.inputTimer = 0;
    this.input.detach();
  }

  // ------------------------------------------------------------ render loop

  private frame(): void {
    const now = performance.now();
    const frameMs = Math.min(100, now - this.lastFrame);
    const dt = frameMs / 1000;
    this.lastFrame = now;
    this.interp.advance(now, frameMs);
    const decay = Math.exp(-dt * 12);
    this.visualOffset.x *= decay;
    this.visualOffset.y *= decay;

    const remote = this.interp.cars();
    const visible = new Set<number>();
    const mapDots: { x: number; y: number; color: string; me: boolean }[] = [];
    for (const c of remote) {
      visible.add(c.slot);
      const view = this.cars.ensure(c.slot, this.seats.get(c.slot)?.color ?? "#cccccc");
      let x = c.x;
      let y = c.y;
      let heading = c.heading;
      let speed = Math.hypot(c.vx, c.vy);
      if (c.slot === this.mySlot && this.predictor?.ready) {
        const p = this.predictor.state;
        x = p.x + this.visualOffset.x;
        y = p.y + this.visualOffset.y;
        heading = p.heading;
        speed = Math.hypot(p.vx, p.vy);
        this.world.follow(x, y, heading, speed, dt, !this.cameraSnapped);
        this.cameraSnapped = true;
      }
      view.update(x, y, heading, speed, c.flags, dt, now);
      mapDots.push({ x, y, color: this.seats.get(c.slot)?.color ?? "#ccc", me: c.slot === this.mySlot });
      this.placeTag(c.slot, x, y);
    }
    if (remote.length > 0) this.cars.retain(visible);
    if (!this.cameraSnapped) this.world.orbit(this.track, now / 1000);
    this.fx.sync(this.interp.projectiles(), now);
    this.fx.update(dt);
    if (this.hud && now - this.lastMapDraw > 100) {
      this.hud.drawMap(mapDots);
      this.lastMapDraw = now;
    }
    this.world.scene.render();
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
    const p = this.world.project(toWorld(x, y, 3));
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
    this.predictor?.dispose();
    this.predictor = null;
    this.interp = new SnapshotInterpolator(this.config.net.tickRate, this.config.net.interpolationDelayMs);
    this.cars.retain(new Set());
    this.fx.sync([], performance.now());
    void this.latest;
  }
}
