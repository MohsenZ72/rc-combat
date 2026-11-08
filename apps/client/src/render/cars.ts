import { Color3, DynamicTexture, Mesh, MeshBuilder, TransformNode, Vector3, type Scene, type StandardMaterial } from "@babylonjs/core";
import { CAR_FLAG } from "@rc/shared";
import { mat, toWorld, type World } from "./world.js";

const WHEEL_RADIUS = 0.34;
const TYRE_THICKNESS = 0.16;
const MAX_STEER_VISUAL = 0.45;

/** One station of a lofted body: x along the car (+x = nose), half width, bottom and roof line. */
interface Station {
  x: number;
  hw: number;
  bottom: number;
  top: number;
}

type BodyStyle = "supercar" | "muscle" | "rally";

/** Side profiles of the three diecast body styles (length 2.6, width ≈ 1.45). */
const BODIES: Record<BodyStyle, { body: Station[]; cabin: Station[] }> = {
  supercar: {
    body: [
      { x: -1.32, hw: 0.05, bottom: 0.3, top: 0.4 },
      { x: -1.3, hw: 0.62, bottom: 0.22, top: 0.62 },
      { x: -1.0, hw: 0.72, bottom: 0.2, top: 0.66 },
      { x: -0.3, hw: 0.73, bottom: 0.2, top: 0.6 },
      { x: 0.4, hw: 0.72, bottom: 0.2, top: 0.52 },
      { x: 1.0, hw: 0.66, bottom: 0.2, top: 0.42 },
      { x: 1.3, hw: 0.56, bottom: 0.22, top: 0.33 },
      { x: 1.33, hw: 0.05, bottom: 0.26, top: 0.3 },
    ],
    cabin: [
      { x: -0.75, hw: 0.05, bottom: 0.6, top: 0.62 },
      { x: -0.7, hw: 0.5, bottom: 0.58, top: 0.8 },
      { x: -0.2, hw: 0.56, bottom: 0.56, top: 0.92 },
      { x: 0.25, hw: 0.54, bottom: 0.52, top: 0.86 },
      { x: 0.62, hw: 0.46, bottom: 0.48, top: 0.56 },
      { x: 0.66, hw: 0.05, bottom: 0.48, top: 0.5 },
    ],
  },
  muscle: {
    body: [
      { x: -1.32, hw: 0.05, bottom: 0.3, top: 0.45 },
      { x: -1.3, hw: 0.66, bottom: 0.22, top: 0.7 },
      { x: -0.8, hw: 0.74, bottom: 0.2, top: 0.72 },
      { x: 0.2, hw: 0.74, bottom: 0.2, top: 0.66 },
      { x: 1.0, hw: 0.72, bottom: 0.2, top: 0.62 },
      { x: 1.3, hw: 0.66, bottom: 0.22, top: 0.55 },
      { x: 1.33, hw: 0.05, bottom: 0.3, top: 0.45 },
    ],
    cabin: [
      { x: -0.65, hw: 0.05, bottom: 0.68, top: 0.7 },
      { x: -0.6, hw: 0.55, bottom: 0.68, top: 0.95 },
      { x: -0.05, hw: 0.58, bottom: 0.66, top: 1.0 },
      { x: 0.4, hw: 0.54, bottom: 0.64, top: 0.72 },
      { x: 0.44, hw: 0.05, bottom: 0.64, top: 0.66 },
    ],
  },
  rally: {
    body: [
      { x: -1.25, hw: 0.05, bottom: 0.3, top: 0.5 },
      { x: -1.22, hw: 0.66, bottom: 0.22, top: 0.7 },
      { x: -0.6, hw: 0.73, bottom: 0.2, top: 0.72 },
      { x: 0.5, hw: 0.73, bottom: 0.2, top: 0.62 },
      { x: 1.15, hw: 0.66, bottom: 0.22, top: 0.5 },
      { x: 1.2, hw: 0.05, bottom: 0.3, top: 0.42 },
    ],
    cabin: [
      { x: -1.05, hw: 0.05, bottom: 0.68, top: 0.7 },
      { x: -1.0, hw: 0.58, bottom: 0.68, top: 1.05 },
      { x: -0.2, hw: 0.6, bottom: 0.66, top: 1.12 },
      { x: 0.35, hw: 0.55, bottom: 0.62, top: 0.74 },
      { x: 0.4, hw: 0.05, bottom: 0.62, top: 0.64 },
    ],
  },
};

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

/** Livery: paint, twin racing stripes over the roof line, number roundels on both doors. */
function liveryTexture(scene: Scene, slot: number, color: string): DynamicTexture {
  // u runs around the cross-section (0.5 = roof centre), v runs rear → nose.
  const tex = new DynamicTexture(`livery${slot}`, { width: 512, height: 512 }, scene, true);
  const c = tex.getContext() as CanvasRenderingContext2D;
  const s = 512;
  c.fillStyle = color;
  c.fillRect(0, 0, s, s);
  c.fillStyle = "rgba(255,255,255,0.92)";
  c.fillRect(s * 0.455, 0, s * 0.03, s);
  c.fillRect(s * 0.515, 0, s * 0.03, s);
  c.fillStyle = "rgba(0,0,0,0.35)";
  for (const u of [0.25, 0.75]) {
    c.save();
    c.translate(s * u, s * 0.28);
    c.rotate(-0.5);
    c.fillRect(-60, -10, 120, 14);
    c.restore();
  }
  const number = String(((slot * 7 + 3) % 98) + 1);
  for (const u of [0.25, 0.75]) {
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(s * u, s * 0.5, 42, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#111111";
    c.font = "bold 52px 'Chakra Petch', Arial, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.save();
    c.translate(s * u, s * 0.5);
    c.rotate(u < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    c.fillText(number, 0, 2);
    c.restore();
  }
  tex.update();
  return tex;
}

interface Wheel {
  pivot: TransformNode;
  tyre: Mesh;
  front: boolean;
}

/**
 * One diecast toy sports car. Hierarchy:
 *   root (position, yaw)
 *   ├─ body (roll/pitch) → lofted shell with livery, glass cabin, lights
 *   └─ wheel pivots (steer) → tyre (spins around local Z) → chrome rim + spokes
 */
class CarView {
  readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly paint: StandardMaterial;
  private readonly wheels: Wheel[] = [];
  private readonly shield: Mesh;
  private readonly flame: Mesh;
  private spin = 0;
  private steer = 0;
  private roll = 0;
  private pitch = 0;
  private lastSpeed = 0;
  /** Low-pass filtered acceleration and yaw rate: raw values step at the network rate and would make the body tremble. */
  private accelF = 0;
  private yawF = 0;
  private flashUntil = 0;

  constructor(world: World, readonly slot: number, color: string) {
    const scene = world.scene;
    const style: BodyStyle = (["supercar", "muscle", "rally"] as const)[slot % 3]!;
    const shape = BODIES[style];
    this.root = new TransformNode(`car${slot}`, scene);
    this.body = new TransformNode(`body${slot}`, scene);
    this.body.parent = this.root;

    this.paint = mat(scene, `paint${slot}`, "#ffffff", { specular: 1, specularPower: 96 });
    this.paint.diffuseTexture = liveryTexture(scene, slot, color);
    const shell = loft("shell", shape.body, scene);
    shell.material = this.paint;
    shell.parent = this.body;

    const glass = mat(scene, `glass${slot}`, "#1a2433", { specular: 1, specularPower: 128, alpha: 0.92 });
    const cabin = loft("cabin", shape.cabin, scene);
    cabin.material = glass;
    cabin.parent = this.body;

    const nose = shape.body[shape.body.length - 2]!;
    const tail = shape.body[1]!;
    const headMat = mat(scene, `head${slot}`, "#fff6d6", { emissive: 0.9 });
    const tailMat = mat(scene, `tail${slot}`, "#ff2a2a", { emissive: 0.8 });
    for (const zSide of [1, -1]) {
      const head = MeshBuilder.CreateBox("headlight", { width: 0.06, height: 0.08, depth: 0.22 }, scene);
      head.material = headMat;
      head.position.set(nose.x + 0.01, (nose.bottom + nose.top) / 2 + 0.02, zSide * nose.hw * 0.6);
      head.parent = this.body;
      const tl = MeshBuilder.CreateBox("taillight", { width: 0.06, height: 0.08, depth: 0.26 }, scene);
      tl.material = tailMat;
      tl.position.set(tail.x - 0.01, tail.top - 0.12, zSide * tail.hw * 0.62);
      tl.parent = this.body;
    }
    if (style === "supercar") {
      const wing = MeshBuilder.CreateBox("wing", { width: 0.28, height: 0.05, depth: 1.3 }, scene);
      wing.material = this.paint;
      wing.position.set(-1.12, 0.86, 0);
      wing.parent = this.body;
    }
    world.shadows.addShadowCaster(shell);
    world.shadows.addShadowCaster(cabin);

    const tyreMat = mat(scene, `tyre${slot}`, "#101114", { specular: 0.05 });
    const chrome = mat(scene, `chrome${slot}`, "#e6eaf0", { specular: 1, specularPower: 128 });
    for (const [x, z] of [[0.82, 0.66], [0.82, -0.66], [-0.82, 0.66], [-0.82, -0.66]] as const) {
      const pivot = new TransformNode("wheel-pivot", scene);
      pivot.parent = this.root;
      pivot.position.set(x, WHEEL_RADIUS, z);
      // Torus around Y → widen along Y (the future axle) BEFORE rotating it onto Z; this keeps the ring circular.
      const tyre = MeshBuilder.CreateTorus("tyre", { diameter: WHEEL_RADIUS * 2 - TYRE_THICKNESS, thickness: TYRE_THICKNESS, tessellation: 48 }, scene);
      tyre.scaling.y = 1.6;
      tyre.rotation.x = Math.PI / 2;
      tyre.bakeCurrentTransformIntoVertices();
      tyre.material = tyreMat;
      tyre.parent = pivot;
      const side = z > 0 ? 1 : -1;
      const rimR = WHEEL_RADIUS - TYRE_THICKNESS + 0.04;
      const rim = MeshBuilder.CreateCylinder("rim", { diameter: rimR * 2, height: 0.16, tessellation: 48 }, scene);
      rim.rotation.x = Math.PI / 2;
      rim.bakeCurrentTransformIntoVertices();
      rim.material = chrome;
      rim.parent = tyre;
      for (let k = 0; k < 5; k++) {
        const spoke = MeshBuilder.CreateBox("spoke", { width: rimR, height: 0.045, depth: 0.03 }, scene);
        spoke.setPivotPoint(new Vector3(-rimR / 2, 0, 0));
        spoke.position.set(rimR / 2, 0, side * 0.085);
        spoke.rotation.z = (k * Math.PI * 2) / 5;
        spoke.material = tyreMat;
        spoke.parent = tyre;
      }
      this.wheels.push({ pivot, tyre, front: x > 0 });
      world.shadows.addShadowCaster(tyre);
    }

    this.shield = MeshBuilder.CreateSphere("shield", { diameter: 3.6, segments: 16 }, scene);
    this.shield.material = mat(scene, `shieldm${slot}`, "#2fd3ff", { emissive: 0.6, alpha: 0.28 });
    this.shield.parent = this.root;
    this.shield.position.y = 0.6;
    this.shield.isVisible = false;
    this.flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.45, height: 1.2, tessellation: 12 }, scene);
    this.flame.material = mat(scene, `flame${slot}`, "#ff9f1c", { emissive: 1, alpha: 0.85 });
    this.flame.parent = this.body;
    this.flame.rotation.z = Math.PI / 2;
    this.flame.position.set(tail.x - 0.65, 0.35, 0);
    this.flame.isVisible = false;
  }

  /**
   * `forwardSpeed` is signed (negative when reversing) so wheels roll backwards.
   * `height` is ground height plus jump height.
   */
  update(x: number, y: number, height: number, heading: number, forwardSpeed: number, yawRate: number, flags: number, dt: number, now: number): void {
    this.root.position.copyFrom(toWorld(x, y, height));
    // Babylon is left-handed: rotating +x towards +z needs a negative yaw.
    this.root.rotation.y = -heading;

    this.spin -= (forwardSpeed * dt) / WHEEL_RADIUS;
    const smooth = Math.min(1, dt * 5);
    this.yawF += (Math.max(-4, Math.min(4, yawRate)) - this.yawF) * smooth;
    const steerTarget = Math.max(-MAX_STEER_VISUAL, Math.min(MAX_STEER_VISUAL, this.yawF * 0.35 * Math.sign(forwardSpeed || 1)));
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 12);
    for (const w of this.wheels) {
      w.tyre.rotation.z = this.spin;
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
    this.paint.emissiveColor = flash ? new Color3(1, 1, 1) : emp ? new Color3(0.1, 0.6, 0.8) : wrecked ? Color3.Black() : new Color3(0.06, 0.06, 0.06);
    this.paint.alpha = ghost ? 0.45 : 1;
    this.paint.diffuseColor = wrecked ? new Color3(0.3, 0.3, 0.3) : Color3.White();
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

  ensure(slot: number, color: string): CarView {
    let v = this.views.get(slot);
    if (!v) {
      v = new CarView(this.world, slot, color);
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
