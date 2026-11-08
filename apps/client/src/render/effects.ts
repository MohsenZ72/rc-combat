import { Mesh, MeshBuilder, Vector3, type Scene, type StandardMaterial } from "@babylonjs/core";
import { ProjectileKind, type ProjectileSnapshot } from "@rc/shared";
import type { Track } from "@rc/game-core";
import { mat, toWorld } from "./world.js";

/** A tiny object pool: meshes are reused, never created per frame. */
class Pool {
  readonly free: Mesh[] = [];
  constructor(private readonly make: () => Mesh) {}
  get(): Mesh {
    const m = this.free.pop() ?? this.make();
    m.setEnabled(true);
    return m;
  }
  put(m: Mesh): void {
    m.setEnabled(false);
    this.free.push(m);
  }
}

interface Burst {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
}

/** Projectiles, mines, item boxes and explosions, all pooled. */
export class Effects {
  private readonly pools: Record<ProjectileKind, Pool>;
  private readonly live = new Map<number, { mesh: Mesh; kind: ProjectileKind }>();
  private readonly boxes: Mesh[] = [];
  private readonly burstPool: Pool;
  private readonly bursts: Burst[] = [];
  private readonly burstMat: StandardMaterial;
  private readonly hints = new Map<number, number>();

  constructor(private readonly scene: Scene, private readonly track: Track) {
    const boltMat = mat(scene, "bolt", "#2fd3ff", { emissive: 1 });
    const rocketMat = mat(scene, "rocket", "#ff5a36", { emissive: 0.6 });
    const mineMat = mat(scene, "mine", "#ff5a36", { emissive: 0.4 });
    this.burstMat = mat(scene, "burst", "#ff9f1c", { emissive: 1, alpha: 0.7 });
    this.pools = {
      [ProjectileKind.Bolt]: new Pool(() => {
        const m = MeshBuilder.CreateCapsule("bolt", { radius: 0.18, height: 1.4, orientation: Vector3.Right() }, scene);
        m.material = boltMat;
        return m;
      }),
      [ProjectileKind.Rocket]: new Pool(() => {
        const m = MeshBuilder.CreateCylinder("rocket", { diameterTop: 0, diameterBottom: 0.5, height: 1.5, tessellation: 8 }, scene);
        m.rotation.z = -Math.PI / 2;
        m.bakeCurrentTransformIntoVertices();
        m.material = rocketMat;
        return m;
      }),
      [ProjectileKind.Mine]: new Pool(() => {
        const m = MeshBuilder.CreateCylinder("mine", { diameter: 1.4, height: 0.35, tessellation: 12 }, scene);
        m.material = mineMat;
        return m;
      }),
    };
    this.burstPool = new Pool(() => {
      const m = MeshBuilder.CreateSphere("burst", { diameter: 1, segments: 6 }, scene);
      m.material = this.burstMat;
      return m;
    });
    const boxMat = mat(scene, "itembox", "#ffc933", { emissive: 0.45, alpha: 0.85 });
    for (const b of track.boxes) {
      const m = MeshBuilder.CreateBox("itembox", { size: 1.6 }, scene);
      m.material = boxMat;
      m.position = toWorld(b.x, b.y, track.heightAt(track.project(b.x, b.y).s) + 1.3);
      this.boxes.push(m);
    }
  }

  sync(projectiles: ProjectileSnapshot[], now: number): void {
    const seen = new Set<number>();
    for (const p of projectiles) {
      seen.add(p.id);
      let entry = this.live.get(p.id);
      if (!entry) {
        entry = { mesh: this.pools[p.kind].get(), kind: p.kind };
        this.live.set(p.id, entry);
      }
      const proj = this.track.project(p.x, p.y, this.hints.get(p.id) ?? -1);
      this.hints.set(p.id, proj.segment);
      const h = this.track.heightAt(proj.s) + (p.kind === ProjectileKind.Mine ? 0.2 : 0.6);
      entry.mesh.position.copyFrom(toWorld(p.x, p.y, h));
      entry.mesh.rotation.y = -p.heading;
      if (p.kind === ProjectileKind.Mine) entry.mesh.visibility = 0.6 + 0.4 * Math.sin(now / 120);
    }
    for (const [id, entry] of this.live) {
      if (seen.has(id)) continue;
      if (entry.kind !== ProjectileKind.Bolt) this.burst(entry.mesh.position.x, entry.mesh.position.z, entry.kind === ProjectileKind.Rocket ? 5 : 3.5, entry.mesh.position.y);
      this.pools[entry.kind].put(entry.mesh);
      this.live.delete(id);
      this.hints.delete(id);
    }
  }

  setBoxes(available: boolean[], now: number): void {
    this.boxes.forEach((m, i) => {
      m.setEnabled(available[i] ?? true);
      m.rotation.y = now / 600 + i;
      m.rotation.x = now / 900 + i;
    });
  }

  burst(x: number, y: number, size: number, height = 1): void {
    const mesh = this.burstPool.get();
    mesh.position.copyFrom(toWorld(x, y, height));
    this.bursts.push({ mesh, age: 0, life: 0.35, size });
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.burstPool.put(b.mesh);
        this.bursts.splice(i, 1);
        continue;
      }
      const s = b.size * (0.3 + t);
      b.mesh.scaling.set(s, s, s);
      b.mesh.visibility = 1 - t;
    }
  }

  dispose(): void {
    for (const m of this.boxes) m.dispose(false, true);
    for (const { mesh } of this.live.values()) mesh.dispose();
    for (const b of this.bursts) b.mesh.dispose();
    for (const pool of [...Object.values(this.pools), this.burstPool]) for (const m of pool.free) m.dispose();
    this.live.clear();
    void this.scene;
  }
}
