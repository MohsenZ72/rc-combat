import { Color3, Mesh, MeshBuilder, TransformNode, Vector3, type Scene, type StandardMaterial } from "@babylonjs/core";
import { CAR_FLAG, DEFAULT_COSMETICS, type Cosmetics } from "@rc/shared";
import { BODY_DEFS, type Station } from "./car/bodies.js";
import { liveryTexture } from "./car/livery.js";
import { buildWheel, finishMaterial, TYRE_SPECS } from "./car/wheels.js";
import { mat, toWorld, type World } from "./world.js";

const MAX_STEER_VISUAL = 0.45;

/** Rounded cross-section (underside → one side → roof → other side), car-local (y up, z sideways). */
function section(st: Station): Vector3[] {
  const { x, hw, bottom, top } = st;
  const mid = bottom + (top - bottom) * 0.55;
  const pts: [number, number][] = [
    [0, bottom],
    [hw * 0.8, bottom],
    [hw, bottom + (top - bottom) * 0.2],
    [hw, mid],
    [hw * 0.92, top - (top - bottom) * 0.12],
    [hw * 0.6, top],
    [0, top + 0.01],
    [-hw * 0.6, top],
    [-hw * 0.92, top - (top - bottom) * 0.12],
    [-hw, mid],
    [-hw, bottom + (top - bottom) * 0.2],
    [-hw * 0.8, bottom],
    [0, bottom],
  ];
  return pts.map(([z, y]) => new Vector3(x, y, z));
}

function loft(name: string, stations: Station[], scene: Scene): Mesh {
  return MeshBuilder.CreateRibbon(name, { pathArray: stations.map(section), sideOrientation: Mesh.DOUBLESIDE }, scene);
}

interface Wheel {
  pivot: TransformNode;
  tyre: Mesh;
  front: boolean;
  radius: number;
}

/**
 * One diecast toy car built from a cosmetics loadout. Hierarchy:
 *   root (position, yaw)
 *   ├─ body (roll/pitch) → lofted shell with livery, glass cabin, lights, extras
 *   └─ wheel pivots (steer) → tyre (spins around local Z) → rim design + hub
 * Every body sits in the same footprint; looks never change the hitbox.
 */
export class CarView {
  readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly paint: StandardMaterial;
  private readonly wheels: Wheel[] = [];
  private readonly shield: Mesh;
  private readonly flame: Mesh;
  private steer = 0;
  private roll = 0;
  private pitch = 0;
  private lastSpeed = 0;
  /** Low-pass filtered acceleration and yaw rate: raw values step at the network rate and would make the body tremble. */
  private accelF = 0;
  private yawF = 0;
  private flashUntil = 0;

  constructor(world: World, readonly key: string, readonly cosmetics: Cosmetics = DEFAULT_COSMETICS) {
    const scene = world.scene;
    const def = BODY_DEFS[cosmetics.body];
    this.root = new TransformNode(`car-${key}`, scene);
    this.body = new TransformNode(`body-${key}`, scene);
    this.body.parent = this.root;

    this.paint = mat(scene, `paint-${key}`, "#ffffff", { specular: 1, specularPower: 96 });
    finishMaterial(this.paint, cosmetics.finish);
    this.paint.diffuseTexture = liveryTexture(scene, key, cosmetics);
    const shell = loft("shell", def.shell, scene);
    shell.material = this.paint;
    shell.parent = this.body;

    const glass = mat(scene, `glass-${key}`, "#1a2433", { specular: 1, specularPower: 128, alpha: 0.9 });
    const cabin = loft("cabin", def.cabin, scene);
    cabin.material = glass;
    cabin.parent = this.body;
    world.shadows.addShadowCaster(shell);
    world.shadows.addShadowCaster(cabin);

    const accent = mat(scene, `accent-${key}`, cosmetics.accent, { specular: 0.6 });
    const trim = mat(scene, `trim-${key}`, "#1b1d22", { specular: 0.3 });
    this.addLights(scene, def.shell, key);
    this.addExtras(scene, def, accent, trim);

    for (const [x, z] of [[def.wheelX[0], def.wheelZ], [def.wheelX[0], -def.wheelZ], [def.wheelX[1], def.wheelZ], [def.wheelX[1], -def.wheelZ]] as const) {
      const radius = def.wheelRadius * TYRE_SPECS[cosmetics.tyres].radiusScale;
      const pivot = new TransformNode("wheel-pivot", scene);
      pivot.parent = this.root;
      pivot.position.set(x, radius, z);
      const tyre = buildWheel(scene, pivot, def.wheelRadius, z > 0 ? 1 : -1, cosmetics.tyres, cosmetics.rims, cosmetics.rimColor, `${key}-${x}-${z}`);
      this.wheels.push({ pivot, tyre, front: x > 0, radius });
      world.shadows.addShadowCaster(tyre);
    }
    // Lift the body so bigger tyres don't sink into it.
    this.body.position.y = Math.max(0, def.wheelRadius * (TYRE_SPECS[cosmetics.tyres].radiusScale - 1));

    this.shield = MeshBuilder.CreateSphere("shield", { diameter: 3.8, segments: 20 }, scene);
    this.shield.material = mat(scene, `shieldm-${key}`, "#2fd3ff", { emissive: 0.6, alpha: 0.24 });
    this.shield.parent = this.root;
    this.shield.position.y = 0.7;
    this.shield.isVisible = false;
    const tail = def.shell[1]!;
    this.flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.45, height: 1.2, tessellation: 12 }, scene);
    this.flame.material = mat(scene, `flame-${key}`, "#ff9f1c", { emissive: 1, alpha: 0.85 });
    this.flame.parent = this.body;
    this.flame.rotation.z = Math.PI / 2;
    this.flame.position.set(tail.x - 0.65, tail.bottom + 0.15, 0);
    this.flame.isVisible = false;
  }

  private addLights(scene: Scene, shell: Station[], key: string): void {
    const nose = shell[shell.length - 2]!;
    const tail = shell[1]!;
    const headMat = mat(scene, `head-${key}`, "#fff6d6", { emissive: 0.9 });
    const tailMat = mat(scene, `tail-${key}`, "#ff2a2a", { emissive: 0.8 });
    for (const zSide of [1, -1]) {
      const head = MeshBuilder.CreateBox("headlight", { width: 0.06, height: 0.09, depth: 0.24 }, scene);
      head.material = headMat;
      head.position.set(nose.x + 0.01, (nose.bottom + nose.top) / 2 + 0.03, zSide * nose.hw * 0.62);
      head.parent = this.body;
      const tl = MeshBuilder.CreateBox("taillight", { width: 0.06, height: 0.09, depth: 0.28 }, scene);
      tl.material = tailMat;
      tl.position.set(tail.x - 0.01, tail.top - 0.12, zSide * tail.hw * 0.62);
      tl.parent = this.body;
    }
  }

  private addExtras(scene: Scene, def: (typeof BODY_DEFS)[keyof typeof BODY_DEFS], accent: StandardMaterial, trim: StandardMaterial): void {
    const roof = def.cabin.reduce((a, s) => Math.max(a, s.top), 0);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial) => {
      const b = MeshBuilder.CreateBox("extra", { width: w, height: h, depth: d }, scene);
      b.position.set(x, y, z);
      b.material = m;
      b.parent = this.body;
      return b;
    };
    for (const extra of def.extras) {
      switch (extra) {
        case "wing":
          box(0.3, 0.05, 1.32, -1.12, 0.88, 0, this.paint);
          box(0.06, 0.24, 0.06, -1.08, 0.74, 0.45, trim);
          box(0.06, 0.24, 0.06, -1.08, 0.74, -0.45, trim);
          break;
        case "ducktail":
          box(0.22, 0.06, 1.2, -1.24, 0.74, 0, this.paint);
          break;
        case "scoop":
          box(0.5, 0.12, 0.4, 0.7, 0.7, 0, trim);
          break;
        case "roofrack":
          for (const z of [0.42, -0.42]) box(1.0, 0.05, 0.05, -0.2, roof + 0.08, z, trim);
          for (const x of [-0.6, 0.2]) box(0.05, 0.05, 0.9, x, roof + 0.08, 0, trim);
          break;
        case "bullbar":
          box(0.08, 0.32, 1.2, def.shell[def.shell.length - 2]!.x + 0.12, 0.62, 0, trim);
          break;
        case "bed":
          // Open load bed: floor plus three walls behind the cab.
          box(1.1, 0.04, 1.3, -0.72, 0.9, 0, trim);
          box(0.05, 0.3, 1.36, -1.28, 1.02, 0, this.paint);
          for (const z of [0.66, -0.66]) box(1.15, 0.3, 0.05, -0.72, 1.02, z, this.paint);
          break;
        case "rollcage": {
          for (const z of [0.38, -0.38]) {
            for (const x of [-0.45, 0.2]) {
              const bar = MeshBuilder.CreateCylinder("cage", { diameter: 0.06, height: 0.62, tessellation: 8 }, scene);
              bar.position.set(x, 0.92, z);
              bar.material = accent;
              bar.parent = this.body;
            }
          }
          for (const x of [-0.45, 0.2]) box(0.06, 0.06, 0.8, x, 1.22, 0, accent);
          box(0.7, 0.06, 0.06, -0.12, 1.22, 0.38, accent);
          box(0.7, 0.06, 0.06, -0.12, 1.22, -0.38, accent);
          break;
        }
      }
    }
  }

  /**
   * `forwardSpeed` is signed (negative when reversing) so wheels roll backwards.
   * `height` is ground height plus jump height.
   */
  update(x: number, y: number, height: number, heading: number, forwardSpeed: number, yawRate: number, flags: number, dt: number, now: number): void {
    this.root.position.copyFrom(toWorld(x, y, height));
    // Babylon is left-handed: rotating +x towards +z needs a negative yaw.
    this.root.rotation.y = -heading;

    const smooth = Math.min(1, dt * 5);
    this.yawF += (Math.max(-4, Math.min(4, yawRate)) - this.yawF) * smooth;
    const steerTarget = Math.max(-MAX_STEER_VISUAL, Math.min(MAX_STEER_VISUAL, this.yawF * 0.35 * Math.sign(forwardSpeed || 1)));
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 12);
    for (const w of this.wheels) {
      // Each wheel rolls by distance / its own radius (big off-road tyres turn slower).
      w.tyre.rotation.z -= (forwardSpeed * dt) / w.radius;
      w.pivot.rotation.y = w.front ? -this.steer : 0;
    }

    const rawAccel = dt > 0 ? (forwardSpeed - this.lastSpeed) / dt : 0;
    this.lastSpeed = forwardSpeed;
    this.accelF += (Math.max(-40, Math.min(40, rawAccel)) - this.accelF) * smooth;
    const airborne = (flags & CAR_FLAG.AIRBORNE) !== 0;
    // Left-handed frame: +rotation.x tips the roof towards the car's left, +rotation.z lifts the nose.
    // Lean out of the turn (opposite to yaw), squat under throttle, dive under braking.
    const rollTarget = Math.max(-0.1, Math.min(0.1, -this.yawF * forwardSpeed * 0.0035));
    const pitchTarget = airborne ? 0.1 : Math.max(-0.06, Math.min(0.06, this.accelF * 0.003));
    const k = Math.min(1, dt * 8);
    this.roll += (rollTarget - this.roll) * k;
    this.pitch += (pitchTarget - this.pitch) * k;
    this.body.rotation.x = this.roll;
    this.body.rotation.z = this.pitch;

    const wrecked = (flags & CAR_FLAG.WRECKED) !== 0;
    const stunned = (flags & CAR_FLAG.STUNNED) !== 0;
    this.root.rotation.z = wrecked ? Math.PI * 0.9 : stunned ? Math.sin(now / 50) * 0.15 : 0;
    this.shield.isVisible = (flags & (CAR_FLAG.SHIELD | CAR_FLAG.SPAWN_PROTECTED)) !== 0;
    this.flame.isVisible = (flags & CAR_FLAG.TURBO) !== 0;
    if (this.flame.isVisible) this.flame.scaling.y = 0.8 + Math.random() * 0.5;
    const ghost = (flags & (CAR_FLAG.FINISHED | CAR_FLAG.DISCONNECTED)) !== 0;
    const emp = (flags & CAR_FLAG.EMP) !== 0;
    const flash = now < this.flashUntil;
    this.paint.emissiveColor = flash ? new Color3(1, 1, 1) : emp ? new Color3(0.1, 0.6, 0.8) : wrecked ? Color3.Black() : new Color3(0.05, 0.05, 0.05);
    this.paint.alpha = ghost ? 0.45 : 1;
    this.paint.diffuseColor = wrecked ? new Color3(0.3, 0.3, 0.3) : Color3.White();
  }

  /** Garage turntable: spin the car in place, wheels idle. */
  showcase(x: number, y: number, height: number, angle: number): void {
    this.root.position.copyFrom(toWorld(x, y, height));
    this.root.rotation.y = angle;
  }

  flash(now: number): void {
    this.flashUntil = now + 120;
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}

export class CarViews {
  private readonly views = new Map<number, CarView>();
  constructor(private readonly world: World, private readonly scene: Scene) {}

  /** Creates (or rebuilds, if the loadout changed) the view for a slot. */
  ensure(slot: number, cosmetics?: Cosmetics): CarView {
    let v = this.views.get(slot);
    if (v && cosmetics && JSON.stringify(v.cosmetics) !== JSON.stringify(cosmetics)) {
      v.dispose();
      v = undefined;
    }
    if (!v) {
      v = new CarView(this.world, `s${slot}-${Math.random().toString(36).slice(2, 7)}`, cosmetics ?? DEFAULT_COSMETICS);
      this.views.set(slot, v);
    }
    return v;
  }

  get(slot: number): CarView | undefined {
    return this.views.get(slot);
  }

  /** Removes cars that left the match. */
  retain(slots: Set<number>): void {
    for (const [slot, v] of this.views) {
      if (!slots.has(slot)) {
        v.dispose();
        this.views.delete(slot);
      }
    }
  }

  dispose(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    void this.scene;
  }
}
