import { Color3, MeshBuilder, TransformNode, Vector3, type Mesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import { CAR_FLAG } from "@rc/shared";
import { mat, toWorld, type World } from "./world.js";

const WHEEL_RADIUS = 0.45;
const TYRE_THICKNESS = 0.24;
const MAX_STEER_VISUAL = 0.45;

interface Wheel {
  /** Steering pivot (front wheels turn left/right around Y). */
  pivot: TransformNode;
  /** Spinning tyre: rolls around its axle (local Z). */
  tyre: Mesh;
  front: boolean;
}

/**
 * One RC buggy. Hierarchy:
 *   root (position, yaw)
 *   ├─ body (roll/pitch from cornering, braking and landing)
 *   │   └─ chassis, shell, nose, wing, antenna…
 *   └─ wheel pivots (steer) → tyre (spin around the axle) → rim spokes
 * Wheels stay on the ground while the body leans, like a real RC car.
 */
class CarView {
  readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly shellMat: StandardMaterial;
  private readonly baseColor: Color3;
  private readonly wheels: Wheel[] = [];
  private readonly shield: Mesh;
  private readonly flame: Mesh;
  private spin = 0;
  private steer = 0;
  private roll = 0;
  private pitch = 0;
  private lastSpeed = 0;
  private flashUntil = 0;

  constructor(world: World, readonly slot: number, color: string) {
    const scene = world.scene;
    this.root = new TransformNode(`car${slot}`, scene);
    this.body = new TransformNode(`body${slot}`, scene);
    this.body.parent = this.root;
    this.baseColor = Color3.FromHexString(color);
    this.shellMat = mat(scene, `shell${slot}`, color, { specular: 0.6 });
    const dark = mat(scene, `chassis${slot}`, "#15181d", { specular: 0.2 });
    const tyreMat = mat(scene, `tyre${slot}`, "#0b0c0e", { specular: 0.05 });
    const rimMat = mat(scene, `rim${slot}`, "#c9d0db", { specular: 0.7 });
    const rimDarkMat = mat(scene, `rimd${slot}`, "#3a4150", { specular: 0.4 });

    const parts: Mesh[] = [];
    const add = (m: Mesh, x: number, y: number, z: number, material: StandardMaterial) => {
      m.position.set(x, y, z);
      m.material = material;
      m.parent = this.body;
      parts.push(m);
      return m;
    };
    add(MeshBuilder.CreateBox("chassis", { width: 2.5, height: 0.3, depth: 1.3 }, scene), 0, 0.5, 0, dark);
    add(MeshBuilder.CreateBox("shell", { width: 1.6, height: 0.55, depth: 1.2 }, scene), -0.1, 0.9, 0, this.shellMat);
    add(MeshBuilder.CreateBox("nose", { width: 0.7, height: 0.28, depth: 1.05 }, scene), 1.0, 0.7, 0, this.shellMat);
    add(MeshBuilder.CreateBox("wing", { width: 0.45, height: 0.08, depth: 1.7 }, scene), -1.2, 1.4, 0, this.shellMat);
    add(MeshBuilder.CreateBox("strut", { width: 0.1, height: 0.5, depth: 0.1 }, scene), -1.15, 1.15, 0, dark);
    add(MeshBuilder.CreateCylinder("antenna", { diameter: 0.05, height: 1.6, tessellation: 4 }, scene), -0.6, 1.75, -0.4, dark);
    add(MeshBuilder.CreateSphere("tip", { diameter: 0.18, segments: 4 }, scene), -0.6, 2.55, -0.4, mat(scene, `tip${slot}`, color, { emissive: 0.8 }));

    for (const [x, z] of [[0.85, 0.82], [0.85, -0.82], [-0.85, 0.82], [-0.85, -0.82]] as const) {
      const pivot = new TransformNode("wheel-pivot", scene);
      pivot.parent = this.root;
      pivot.position.set(x, WHEEL_RADIUS, z);
      // Rounded rubber tyre: a smooth torus (48 segments) around the axle. Babylon builds
      // tori/cylinders around Y, so bake a 90° X rotation to put the axle on Z.
      const tyre = MeshBuilder.CreateTorus("tyre", { diameter: WHEEL_RADIUS * 2 - TYRE_THICKNESS, thickness: TYRE_THICKNESS, tessellation: 48 }, scene);
      // Scaling applies before rotation: widen along the torus axis (local Y, which becomes the
      // axle after the 90° turn). Scaling Z here would squash the ring into an ellipse.
      tyre.scaling.y = 1.7; // wide RC buggy tread
      tyre.rotation.x = Math.PI / 2;
      tyre.bakeCurrentTransformIntoVertices();
      tyre.material = tyreMat;
      tyre.parent = pivot;
      const side = z > 0 ? 1 : -1;
      // Rim disc fills the tyre, then five spokes and a hub cap on the outer face.
      const rim = MeshBuilder.CreateCylinder("rim", { diameter: (WHEEL_RADIUS - TYRE_THICKNESS) * 2 + 0.08, height: 0.2, tessellation: 48 }, scene);
      rim.rotation.x = Math.PI / 2;
      rim.bakeCurrentTransformIntoVertices();
      rim.material = rimDarkMat;
      rim.parent = tyre;
      for (let k = 0; k < 5; k++) {
        const spoke = MeshBuilder.CreateBox("spoke", { width: WHEEL_RADIUS - TYRE_THICKNESS + 0.02, height: 0.07, depth: 0.04 }, scene);
        spoke.setPivotPoint(new Vector3(-(WHEEL_RADIUS - TYRE_THICKNESS + 0.02) / 2, 0, 0));
        spoke.position.set((WHEEL_RADIUS - TYRE_THICKNESS + 0.02) / 2, 0, side * 0.11);
        spoke.rotation.z = (k * Math.PI * 2) / 5;
        spoke.material = rimMat;
        spoke.parent = tyre;
      }
      const hub = MeshBuilder.CreateCylinder("hub", { diameter: 0.14, height: 0.06, tessellation: 32 }, scene);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = side * 0.13;
      hub.material = mat(scene, `hub${slot}`, color, { specular: 0.8 });
      hub.parent = tyre;
      this.wheels.push({ pivot, tyre, front: x > 0 });
      world.shadows.addShadowCaster(tyre);
    }
    for (const m of parts) world.shadows.addShadowCaster(m);

    this.shield = MeshBuilder.CreateSphere("shield", { diameter: 3.9, segments: 12 }, scene);
    this.shield.material = mat(scene, `shieldm${slot}`, "#2fd3ff", { emissive: 0.6, alpha: 0.28 });
    this.shield.parent = this.root;
    this.shield.position.y = 0.9;
    this.shield.isVisible = false;
    this.flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.7, height: 1.6, tessellation: 8 }, scene);
    this.flame.material = mat(scene, `flame${slot}`, "#ff9f1c", { emissive: 1, alpha: 0.85 });
    this.flame.parent = this.body;
    this.flame.rotation.z = Math.PI / 2;
    this.flame.position.set(-2.0, 0.65, 0);
    this.flame.isVisible = false;
  }

  /**
   * `forwardSpeed` is signed (negative when reversing) so wheels roll backwards.
   * `yawRate` drives front-wheel steering and body roll.
   */
  update(x: number, y: number, z: number, heading: number, forwardSpeed: number, yawRate: number, flags: number, dt: number, now: number): void {
    this.root.position.copyFrom(toWorld(x, y, z));
    // Babylon is left-handed: rotating +x towards +z needs a negative yaw.
    this.root.rotation.y = -heading;

    // Roll the tyres by distance travelled (arc length / radius). Airborne wheels keep spinning freely.
    this.spin -= (forwardSpeed * dt) / WHEEL_RADIUS;
    const steerTarget = Math.max(-MAX_STEER_VISUAL, Math.min(MAX_STEER_VISUAL, yawRate * 0.35 * Math.sign(forwardSpeed || 1)));
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 12);
    for (const w of this.wheels) {
      w.tyre.rotation.z = this.spin;
      // Positive game yaw turns left; in this left-handed frame that is a negative Y rotation.
      w.pivot.rotation.y = w.front ? -this.steer : 0;
    }

    // Body lean: roll out of corners, pitch under acceleration/braking, nose-up in the air.
    const accel = dt > 0 ? (forwardSpeed - this.lastSpeed) / dt : 0;
    this.lastSpeed = forwardSpeed;
    const airborne = (flags & CAR_FLAG.AIRBORNE) !== 0;
    // Left-handed frame: +rotation.x tips the roof towards the car's left, +rotation.z lifts the nose.
    // Lean out of the turn (opposite to yaw), squat under throttle, dive under braking.
    const rollTarget = Math.max(-0.12, Math.min(0.12, -yawRate * forwardSpeed * 0.004));
    const pitchTarget = airborne ? 0.12 : Math.max(-0.08, Math.min(0.08, accel * 0.004));
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
    this.shellMat.emissiveColor = flash ? new Color3(1, 1, 1) : emp ? new Color3(0.1, 0.6, 0.8) : Color3.Black();
    this.shellMat.alpha = ghost ? 0.45 : 1;
    this.shellMat.diffuseColor = wrecked ? this.baseColor.scale(0.3) : this.baseColor;
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
