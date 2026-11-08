import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import { pbr, REAL_CM, type SurfaceId } from "../materials.js";
import { loadModel, type ModelId } from "./models.js";

export interface MatOpts {
  spec?: number;
  power?: number;
  emissive?: number;
  alpha?: number;
  rough?: number;
  metal?: number;
  clearCoat?: number;
  /** Photo-scanned material, tinted by the colour. "none" opts out of automatic wood grain. */
  surface?: SurfaceId | "none";
}

/** Brown, moderately saturated colours are wood unless a piece says otherwise. */
function looksLikeWood(hex: string): boolean {
  const c = Color3.FromHexString(hex);
  const hsv = c.toHSV();
  return hsv.r >= 14 && hsv.r <= 42 && hsv.g >= 0.3 && hsv.g <= 0.8 && hsv.b >= 0.12 && hsv.b <= 0.85;
}

/**
 * Small modelling kit for building furniture out of primitives. Each piece
 * is built in its own local frame (x right, y up, z depth) under a group
 * node; `finish()` merges a group's meshes into one draw call per material.
 */
export class Kit {
  private readonly mats = new Map<string, PBRMaterial>();
  /** Model loads still running per group (see `whenLoaded`). */
  private readonly pending = new WeakMap<TransformNode, Promise<void>[]>();

  constructor(
    readonly scene: Scene,
    readonly root: TransformNode,
    private readonly shadows: ShadowGenerator,
  ) {}

  /**
   * Cached PBR material. Brown colours automatically get real wood grain;
   * pass `surface` for fabric, leather, stone… Textures tile at real size
   * because `finish()` gives every piece box-projected UVs in metres.
   */
  mat(hex: string, o: MatOpts = {}): PBRMaterial {
    const surface = o.surface === "none" ? undefined : (o.surface ?? (!o.emissive && o.alpha === undefined && looksLikeWood(hex) ? "wood" : undefined));
    const key = `${hex}|${o.spec ?? 0.2}|${o.power ?? 32}|${o.emissive ?? 0}|${o.alpha ?? 1}|${o.rough ?? ""}|${o.metal ?? ""}|${o.clearCoat ?? 0}|${surface ?? ""}`;
    let m = this.mats.get(key);
    if (!m) {
      // Varnished wood keeps a soft sheen; other scans use their measured roughness.
      const varnish = surface === "wood" || surface === "wood-fine" || surface === "oak" ? 0.5 : 0;
      m = pbr(this.scene, `kit-${key}`, hex, {
        specular: o.spec,
        specularPower: o.power,
        emissive: o.emissive,
        alpha: o.alpha,
        rough: o.rough,
        metal: o.metal,
        clearCoat: o.clearCoat ?? varnish,
        surface,
        tiling: "metres",
      });
      this.mats.set(key, m);
    }
    return m;
  }

  /** A furniture piece placed at game (x, y) on the floor at `height`, rotated by `yaw` (radians, game frame). */
  group(name: string, x: number, y: number, yaw = 0, height = 0): TransformNode {
    const g = new TransformNode(name, this.scene);
    g.parent = this.root;
    g.position.set(x, height, y);
    g.rotation.y = -yaw;
    return g;
  }

  /** A piece standing at game (x, y) whose local +z (its "front") faces the game direction (nx, ny). */
  facing(name: string, x: number, y: number, nx: number, ny: number, height = 0): TransformNode {
    const g = new TransformNode(name, this.scene);
    g.parent = this.root;
    g.position.set(x, height, y);
    g.rotation.y = Math.atan2(nx, ny);
    return g;
  }

  private place(m: Mesh, parent: TransformNode, pos: [number, number, number], material: PBRMaterial, rot?: [number, number, number]): Mesh {
    m.parent = parent;
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.material = material;
    return m;
  }

  /** Box with its centre at pos. */
  box(p: TransformNode, size: [number, number, number], pos: [number, number, number], m: PBRMaterial, rot?: [number, number, number]): Mesh {
    return this.place(MeshBuilder.CreateBox("k-box", { width: size[0], height: size[1], depth: size[2] }, this.scene), p, pos, m, rot);
  }

  cyl(p: TransformNode, d: number, h: number, pos: [number, number, number], m: PBRMaterial, o: { top?: number; tess?: number; rot?: [number, number, number] } = {}): Mesh {
    const mesh = MeshBuilder.CreateCylinder("k-cyl", { diameterBottom: d, diameterTop: o.top ?? d, height: h, tessellation: o.tess ?? 24 }, this.scene);
    return this.place(mesh, p, pos, m, o.rot);
  }

  sphere(p: TransformNode, d: number, pos: [number, number, number], m: PBRMaterial, scale?: [number, number, number]): Mesh {
    const s = MeshBuilder.CreateSphere("k-sph", { diameter: d, segments: 16 }, this.scene);
    this.place(s, p, pos, m);
    if (scale) s.scaling.set(scale[0], scale[1], scale[2]);
    return s;
  }

  torus(p: TransformNode, d: number, t: number, pos: [number, number, number], m: PBRMaterial, rot?: [number, number, number]): Mesh {
    return this.place(MeshBuilder.CreateTorus("k-tor", { diameter: d, thickness: t, tessellation: 32 }, this.scene), p, pos, m, rot);
  }

  plane(p: TransformNode, w: number, h: number, pos: [number, number, number], m: PBRMaterial, rot?: [number, number, number]): Mesh {
    return this.place(MeshBuilder.CreatePlane("k-pl", { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, this.scene), p, pos, m, rot);
  }

  /**
   * Place a photo-scanned prop (real-world metres in the file) at local
   * `pos`, turned by `rotY`. Loads asynchronously; `whenLoaded(group)`
   * resolves once every model in the group is in the scene.
   */
  model(p: TransformNode, id: ModelId, pos: [number, number, number] = [0, 0, 0], o: { rotY?: number; scale?: number } = {}): TransformNode {
    const holder = new TransformNode(`model-${id}`, this.scene);
    holder.parent = p;
    holder.position.set(pos[0], pos[1], pos[2]);
    holder.rotation.y = o.rotY ?? 0;
    holder.scaling.setAll(100 * REAL_CM * (o.scale ?? 1));
    let group: TransformNode = p;
    while (group.parent instanceof TransformNode && group.parent !== this.root) group = group.parent;
    const job = loadModel(this.scene, id).then((container) => {
      if (!container || holder.isDisposed()) return;
      const inst = container.instantiateModelsToScene((n) => `${id}:${n}`, false);
      for (const node of inst.rootNodes) node.parent = holder;
      for (const mesh of holder.getChildMeshes(false)) {
        mesh.material?.freeze();
        mesh.receiveShadows = true;
        this.shadows.addShadowCaster(mesh, false);
        mesh.computeWorldMatrix(true);
        mesh.freezeWorldMatrix();
      }
    });
    const list = this.pending.get(group) ?? [];
    list.push(job);
    this.pending.set(group, list);
    return holder;
  }

  /** Freeze every cached material (call once the room is built). */
  freezeMaterials(): void {
    for (const m of this.mats.values()) m.freeze();
  }

  /** Resolves when all models placed under this group have loaded. */
  whenLoaded(g: TransformNode): Promise<void> {
    return Promise.all(this.pending.get(g) ?? []).then(() => undefined);
  }

  /** Merge a finished group's meshes (one draw call per material) and register it as a shadow caster. */
  finish(g: TransformNode, castShadow = true): Mesh | null {
    const meshes = g.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    if (meshes.length === 0) return null;
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
    if (!merged) return null;
    merged.parent = g;
    merged.position.set(0, 0, 0);
    merged.rotation.set(0, 0, 0);
    merged.scaling.set(1, 1, 1);
    // MergeMeshes bakes world transforms; re-express vertices relative to the group.
    const inv = g.computeWorldMatrix(true).clone().invert();
    merged.bakeTransformIntoVertices(inv);
    boxProjectUVs(merged);
    merged.freezeWorldMatrix();
    merged.receiveShadows = true;
    if (castShadow) this.shadows.addShadowCaster(merged);
    return merged;
  }

  v(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
  }
}

/**
 * Replace a mesh's UVs with box projection in local metres: each vertex
 * takes the two coordinates across its dominant normal axis. Scanned
 * materials then tile at their real size on every face, whatever the
 * primitive's own 0..1 UVs were.
 */
function boxProjectUVs(mesh: Mesh): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nor) return;
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const ax = Math.abs(nor[i]!);
    const ay = Math.abs(nor[i + 1]!);
    const az = Math.abs(nor[i + 2]!);
    if (ay >= ax && ay >= az) {
      uv[j] = pos[i]!;
      uv[j + 1] = pos[i + 2]!;
    } else if (ax >= az) {
      uv[j] = pos[i + 2]!;
      uv[j + 1] = pos[i + 1]!;
    } else {
      uv[j] = pos[i]!;
      uv[j + 1] = pos[i + 1]!;
    }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv, false);
}
