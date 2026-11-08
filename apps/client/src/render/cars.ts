import { Color3, Mesh, MeshBuilder, TransformNode, type Scene, type StandardMaterial } from "@babylonjs/core";
import { CAR_FLAG } from "@rc/shared";
import { mat, toWorld, type World } from "./world.js";

/** One RC buggy: chassis, shell, wheels, wing, whip antenna + effect shells. */
class CarView {
  readonly root: TransformNode;
  private readonly shellMat: StandardMaterial;
  private readonly baseColor: Color3;
  private readonly wheels: Mesh[] = [];
  private readonly shield: Mesh;
  private readonly flame: Mesh;
  private wheelSpin = 0;
  private flashUntil = 0;

  constructor(world: World, readonly slot: number, color: string) {
    const scene = world.scene;
    this.root = new TransformNode(`car${slot}`, scene);
    this.baseColor = Color3.FromHexString(color);
    this.shellMat = mat(scene, `shell${slot}`, color, { specular: 0.6 });
    const dark = mat(scene, `chassis${slot}`, "#15181d", { specular: 0.2 });
    const tyre = mat(scene, `tyre${slot}`, "#0b0c0e", { specular: 0.05 });

    const chassis = MeshBuilder.CreateBox("chassis", { width: 2.6, height: 0.35, depth: 1.5 }, scene);
    chassis.material = dark;
    chassis.position.y = 0.45;
    const shell = MeshBuilder.CreateBox("shell", { width: 1.7, height: 0.55, depth: 1.25 }, scene);
    shell.material = this.shellMat;
    shell.position.set(-0.05, 0.85, 0);
    const nose = MeshBuilder.CreateBox("nose", { width: 0.7, height: 0.3, depth: 1.1 }, scene);
    nose.material = this.shellMat;
    nose.position.set(1.05, 0.65, 0);
    const wing = MeshBuilder.CreateBox("wing", { width: 0.4, height: 0.08, depth: 1.6 }, scene);
    wing.material = this.shellMat;
    wing.position.set(-1.25, 1.35, 0);
    const strut = MeshBuilder.CreateBox("strut", { width: 0.1, height: 0.5, depth: 0.1 }, scene);
    strut.material = dark;
    strut.position.set(-1.2, 1.1, 0);
    const antenna = MeshBuilder.CreateCylinder("antenna", { diameter: 0.05, height: 1.6, tessellation: 4 }, scene);
    antenna.material = dark;
    antenna.position.set(-0.6, 1.7, -0.45);
    const tip = MeshBuilder.CreateSphere("tip", { diameter: 0.18, segments: 4 }, scene);
    tip.material = mat(scene, `tip${slot}`, color, { emissive: 0.8 });
    tip.position.set(-0.6, 2.5, -0.45);
    for (const [x, z] of [[0.85, 0.85], [0.85, -0.85], [-0.85, 0.85], [-0.85, -0.85]] as const) {
      const w = MeshBuilder.CreateCylinder("wheel", { diameter: 0.9, height: 0.45, tessellation: 14 }, scene);
      w.material = tyre;
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.45, z);
      w.parent = this.root;
      this.wheels.push(w);
      world.shadows.addShadowCaster(w);
    }
    for (const m of [chassis, shell, nose, wing, strut, antenna, tip]) {
      m.parent = this.root;
      world.shadows.addShadowCaster(m);
    }
    this.shield = MeshBuilder.CreateSphere("shield", { diameter: 3.8, segments: 12 }, scene);
    this.shield.material = mat(scene, `shieldm${slot}`, "#2fd3ff", { emissive: 0.6, alpha: 0.28 });
    this.shield.parent = this.root;
    this.shield.position.y = 0.8;
    this.shield.isVisible = false;
    this.flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.7, height: 1.6, tessellation: 8 }, scene);
    this.flame.material = mat(scene, `flame${slot}`, "#ff9f1c", { emissive: 1, alpha: 0.85 });
    this.flame.parent = this.root;
    this.flame.rotation.z = Math.PI / 2;
    this.flame.position.set(-2.1, 0.6, 0);
    this.flame.isVisible = false;
  }

  update(x: number, y: number, heading: number, speed: number, flags: number, dt: number, now: number): void {
    this.root.position.copyFrom(toWorld(x, y, 0));
    // Babylon is left-handed: rotating +x towards +z needs a negative yaw.
    this.root.rotation.y = -heading;
    this.wheelSpin += speed * dt * 2.2;
    for (const w of this.wheels) w.rotation.y = this.wheelSpin;
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

  /** Hide cars that left the match. */
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
