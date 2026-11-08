import { DynamicTexture, Mesh, MeshBuilder, TransformNode, Vector3, type ParticleSystem, type Scene, type StandardMaterial } from "@babylonjs/core";
import { ProjectileKind, type ProjectileSnapshot } from "@rc/shared";
import type { Track } from "@rc/game-core";
import { Bursts, flareTexture, trail, type BurstKind } from "./fx/particles.js";
import { mat, toWorld } from "./world.js";

interface Live {
  node: TransformNode;
  kind: ProjectileKind;
  trail: ParticleSystem | null;
  light: Mesh | null;
}

/**
 * Projectiles, item boxes and every visual effect: rocket models with
 * exhaust and smoke trails, bombs with a burning fuse and a blinking light,
 * glowing bolts, gift-box item boxes, explosions with fire/smoke/debris.
 * All pooled; nothing is created per frame during a race.
 */
export class Effects {
  private readonly free: Record<ProjectileKind, Live[]> = { [ProjectileKind.Bolt]: [], [ProjectileKind.Rocket]: [], [ProjectileKind.Mine]: [] };
  private readonly live = new Map<number, Live>();
  private readonly hints = new Map<number, number>();
  private readonly boxes: TransformNode[] = [];
  private readonly boxBase: number[] = [];
  private readonly mats: Record<string, StandardMaterial>;
  private readonly bursts: Bursts;
  private readonly tex;
  private readonly owned: TransformNode[] = [];
  /** Called with (x, z) of big explosions so the camera can shake. */
  onExplosion: ((x: number, z: number, power: number) => void) | null = null;

  constructor(private readonly scene: Scene, private readonly track: Track) {
    this.tex = flareTexture(scene);
    this.bursts = new Bursts(scene, this.tex);
    this.mats = {
      rocketBody: mat(scene, "rocket-body", "#f2f2f2", { specular: 0.8, specularPower: 64 }),
      rocketNose: mat(scene, "rocket-nose", "#e2413b", { specular: 0.8, specularPower: 64 }),
      rocketFin: mat(scene, "rocket-fin", "#2a2d31", { specular: 0.4 }),
      exhaust: mat(scene, "rocket-exhaust", "#ffb21a", { emissive: 1, alpha: 0.9 }),
      bomb: mat(scene, "bomb", "#1b1d22", { specular: 0.9, specularPower: 96 }),
      fuse: mat(scene, "fuse", "#c9a07a", { specular: 0.1 }),
      led: mat(scene, "led", "#ff2a2a", { emissive: 1 }),
      bolt: mat(scene, "bolt", "#9feeff", { emissive: 1 }),
      boltCore: mat(scene, "bolt-core", "#ffffff", { emissive: 1 }),
    };
    this.buildBoxes();
  }

  // ------------------------------------------------------------------ item boxes

  private buildBoxes(): void {
    const tex = new DynamicTexture("gift", { width: 256, height: 256 }, this.scene, true);
    const g = tex.getContext() as CanvasRenderingContext2D;
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, "#ffd84a");
    grad.addColorStop(1, "#ff9f1c");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#e2413b";
    g.fillRect(108, 0, 40, 256);
    g.fillRect(0, 108, 256, 40);
    g.fillStyle = "#ffffff";
    g.font = "bold 120px 'Chakra Petch', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.strokeStyle = "#1b1500";
    g.lineWidth = 10;
    g.strokeText("?", 70, 70);
    g.fillText("?", 70, 70);
    tex.update();
    const boxMat = mat(this.scene, "itembox", "#ffffff", { specular: 0.6, emissive: 0.25 });
    boxMat.diffuseTexture = tex;
    const ribbon = mat(this.scene, "ribbon", "#e2413b", { specular: 0.6 });
    for (const b of this.track.boxes) {
      const node = new TransformNode("itembox", this.scene);
      const h = this.track.heightAt(this.track.project(b.x, b.y).s);
      node.position.copyFrom(toWorld(b.x, b.y, h + 1.4));
      const cube = MeshBuilder.CreateBox("gift", { size: 1.7 }, this.scene);
      cube.material = boxMat;
      cube.parent = node;
      for (const r of [0, Math.PI / 2]) {
        const bow = MeshBuilder.CreateTorus("bow", { diameter: 0.7, thickness: 0.16, tessellation: 16 }, this.scene);
        bow.rotation.set(Math.PI / 2, r, 0.5);
        bow.position.y = 1;
        bow.material = ribbon;
        bow.parent = node;
      }
      this.boxes.push(node);
      this.boxBase.push(h + 1.4);
    }
  }

  setBoxes(available: boolean[], now: number): void {
    this.boxes.forEach((node, i) => {
      const was = node.isEnabled();
      const on = available[i] ?? true;
      if (was && !on) this.bursts.emit("sparkle", node.position.x, node.position.y, node.position.z, 1.4);
      node.setEnabled(on);
      node.rotation.y = now / 700 + i;
      node.position.y = this.boxBase[i]! + Math.sin(now / 300 + i) * 0.25;
    });
  }

  // ------------------------------------------------------------------ projectiles

  private make(kind: ProjectileKind): Live {
    const node = new TransformNode(`proj-${kind}`, this.scene);
    this.owned.push(node);
    let tr: ParticleSystem | null = null;
    let light: Mesh | null = null;
    if (kind === ProjectileKind.Rocket) {
      const body = MeshBuilder.CreateCylinder("rocket-body", { diameter: 0.42, height: 1.5, tessellation: 16 }, this.scene);
      body.rotation.z = -Math.PI / 2;
      body.material = this.mats.rocketBody!;
      body.parent = node;
      const nose = MeshBuilder.CreateCylinder("rocket-nose", { diameterTop: 0, diameterBottom: 0.42, height: 0.55, tessellation: 16 }, this.scene);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 1.02;
      nose.material = this.mats.rocketNose!;
      nose.parent = node;
      for (let i = 0; i < 4; i++) {
        const fin = MeshBuilder.CreateBox("fin", { width: 0.45, height: 0.04, depth: 0.32 }, this.scene);
        fin.position.set(-0.6, 0, 0);
        fin.rotation.x = (i * Math.PI) / 2;
        fin.material = this.mats.rocketFin!;
        fin.parent = node;
      }
      const flame = MeshBuilder.CreateCylinder("rocket-flame", { diameterTop: 0.34, diameterBottom: 0, height: 0.9, tessellation: 12 }, this.scene);
      flame.rotation.z = -Math.PI / 2;
      flame.position.x = -1.15;
      flame.material = this.mats.exhaust!;
      flame.parent = node;
      light = flame;
      tr = trail(this.scene, this.tex, "rocket");
    } else if (kind === ProjectileKind.Mine) {
      const bomb = MeshBuilder.CreateSphere("bomb", { diameter: 1.25, segments: 20 }, this.scene);
      bomb.position.y = 0.55;
      bomb.material = this.mats.bomb!;
      bomb.parent = node;
      const cap = MeshBuilder.CreateCylinder("cap", { diameter: 0.4, height: 0.18, tessellation: 12 }, this.scene);
      cap.position.y = 1.18;
      cap.material = this.mats.rocketFin!;
      cap.parent = node;
      const fuse = MeshBuilder.CreateCylinder("fuse", { diameter: 0.08, height: 0.45, tessellation: 6 }, this.scene);
      fuse.position.set(0.08, 1.42, 0);
      fuse.rotation.z = -0.4;
      fuse.material = this.mats.fuse!;
      fuse.parent = node;
      const led = MeshBuilder.CreateSphere("led", { diameter: 0.18, segments: 8 }, this.scene);
      led.position.set(0, 0.62, 0.6);
      led.material = this.mats.led!;
      led.parent = node;
      light = led;
      tr = trail(this.scene, this.tex, "fuse");
    } else {
      const glow = MeshBuilder.CreateCapsule("bolt", { radius: 0.2, height: 1.6, orientation: Vector3.Right() }, this.scene);
      glow.material = this.mats.bolt!;
      glow.parent = node;
      const core = MeshBuilder.CreateCapsule("bolt-core", { radius: 0.09, height: 1.2, orientation: Vector3.Right() }, this.scene);
      core.material = this.mats.boltCore!;
      core.parent = node;
    }
    return { node, kind, trail: tr, light };
  }

  private take(kind: ProjectileKind): Live {
    const l = this.free[kind].pop() ?? this.make(kind);
    l.node.setEnabled(true);
    l.trail?.start();
    return l;
  }

  private release(l: Live): void {
    l.node.setEnabled(false);
    l.trail?.stop();
    this.free[l.kind].push(l);
  }

  sync(projectiles: ProjectileSnapshot[], now: number): void {
    const seen = new Set<number>();
    for (const p of projectiles) {
      seen.add(p.id);
      let entry = this.live.get(p.id);
      if (!entry) {
        entry = this.take(p.kind);
        this.live.set(p.id, entry);
      }
      const proj = this.track.project(p.x, p.y, this.hints.get(p.id) ?? -1);
      this.hints.set(p.id, proj.segment);
      const ground = this.track.heightAt(proj.s);
      const h = ground + (p.kind === ProjectileKind.Mine ? 0 : 0.7);
      entry.node.position.copyFrom(toWorld(p.x, p.y, h));
      entry.node.rotation.y = -p.heading;
      if (p.kind === ProjectileKind.Rocket) {
        entry.node.rotation.x = now / 60; // spin around its axis
        if (entry.light) entry.light.scaling.y = 0.8 + Math.random() * 0.5;
        if (entry.trail) (entry.trail.emitter as Vector3).copyFrom(toWorld(p.x - Math.cos(p.heading) * 1.2, p.y - Math.sin(p.heading) * 1.2, h));
      } else if (p.kind === ProjectileKind.Mine) {
        if (entry.light) entry.light.setEnabled(Math.floor(now / 250) % 2 === 0);
        if (entry.trail) (entry.trail.emitter as Vector3).copyFrom(entry.node.position.add(new Vector3(0.25, 1.65, 0)));
      }
    }
    for (const [id, entry] of this.live) {
      if (seen.has(id)) continue;
      const p = entry.node.position;
      if (entry.kind === ProjectileKind.Bolt) this.bursts.emit("sparks", p.x, p.y, p.z, 0.8);
      else this.explode(p.x, p.y + 0.5, p.z, entry.kind === ProjectileKind.Rocket ? 1.3 : 1);
      this.release(entry);
      this.live.delete(id);
      this.hints.delete(id);
    }
  }

  /** Fireball, smoke column, flying debris and a camera shake nearby. */
  explode(x: number, y: number, z: number, power = 1): void {
    this.bursts.emit("fire", x, y, z, power);
    this.bursts.emit("smoke", x, y + 0.5, z, power);
    this.bursts.emit("debris", x, y, z, power);
    this.onExplosion?.(x, z, power);
  }

  burst(kind: BurstKind, x: number, y: number, z: number, scale = 1): void {
    this.bursts.emit(kind, x, y, z, scale);
  }

  /** Kept for API compatibility with the render loop (particles update themselves). */
  update(_dt: number): void {}

  dispose(): void {
    for (const n of this.boxes) n.dispose(false, true);
    for (const l of this.live.values()) l.trail?.dispose();
    for (const list of Object.values(this.free)) for (const l of list) l.trail?.dispose();
    for (const n of this.owned) n.dispose(false, false);
    this.live.clear();
    this.bursts.dispose();
  }
}
