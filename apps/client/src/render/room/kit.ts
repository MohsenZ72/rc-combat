import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";

export interface MatOpts {
  spec?: number;
  power?: number;
  emissive?: number;
  alpha?: number;
}

/**
 * Small modelling kit for building furniture out of primitives. Each piece
 * is built in its own local frame (x right, y up, z depth) under a group
 * node; `finish()` merges a group's meshes into one draw call per material.
 */
export class Kit {
  private readonly mats = new Map<string, StandardMaterial>();

  constructor(
    readonly scene: Scene,
    readonly root: TransformNode,
    private readonly shadows: ShadowGenerator,
  ) {}

  mat(hex: string, o: MatOpts = {}): StandardMaterial {
    const key = `${hex}|${o.spec ?? 0.2}|${o.power ?? 32}|${o.emissive ?? 0}|${o.alpha ?? 1}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`kit-${key}`, this.scene);
      const c = Color3.FromHexString(hex);
      m.diffuseColor = c;
      const sp = o.spec ?? 0.2;
      m.specularColor = new Color3(sp, sp, sp);
      m.specularPower = o.power ?? 32;
      if (o.emissive) m.emissiveColor = c.scale(o.emissive);
      if (o.alpha !== undefined && o.alpha < 1) {
        m.alpha = o.alpha;
        m.backFaceCulling = false;
      }
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

  private place(m: Mesh, parent: TransformNode, pos: [number, number, number], material: StandardMaterial, rot?: [number, number, number]): Mesh {
    m.parent = parent;
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.material = material;
    return m;
  }

  /** Box with its centre at pos. */
  box(p: TransformNode, size: [number, number, number], pos: [number, number, number], m: StandardMaterial, rot?: [number, number, number]): Mesh {
    return this.place(MeshBuilder.CreateBox("k-box", { width: size[0], height: size[1], depth: size[2] }, this.scene), p, pos, m, rot);
  }

  cyl(p: TransformNode, d: number, h: number, pos: [number, number, number], m: StandardMaterial, o: { top?: number; tess?: number; rot?: [number, number, number] } = {}): Mesh {
    const mesh = MeshBuilder.CreateCylinder("k-cyl", { diameterBottom: d, diameterTop: o.top ?? d, height: h, tessellation: o.tess ?? 24 }, this.scene);
    return this.place(mesh, p, pos, m, o.rot);
  }

  sphere(p: TransformNode, d: number, pos: [number, number, number], m: StandardMaterial, scale?: [number, number, number]): Mesh {
    const s = MeshBuilder.CreateSphere("k-sph", { diameter: d, segments: 16 }, this.scene);
    this.place(s, p, pos, m);
    if (scale) s.scaling.set(scale[0], scale[1], scale[2]);
    return s;
  }

  torus(p: TransformNode, d: number, t: number, pos: [number, number, number], m: StandardMaterial, rot?: [number, number, number]): Mesh {
    return this.place(MeshBuilder.CreateTorus("k-tor", { diameter: d, thickness: t, tessellation: 32 }, this.scene), p, pos, m, rot);
  }

  plane(p: TransformNode, w: number, h: number, pos: [number, number, number], m: StandardMaterial, rot?: [number, number, number]): Mesh {
    return this.place(MeshBuilder.CreatePlane("k-pl", { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, this.scene), p, pos, m, rot);
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
    merged.freezeWorldMatrix();
    merged.receiveShadows = true;
    if (castShadow) this.shadows.addShadowCaster(merged);
    return merged;
  }

  v(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
  }
}
