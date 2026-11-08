import { MeshBuilder, TransformNode, Vector3, type Mesh, type PBRMaterial, type Scene } from "@babylonjs/core";
import type { RimColor, RimId, TyreId } from "@rc/shared";
import { mat } from "../world.js";

/** Rim finishes as physical materials: plated metals vs painted (lacquered) alloys. */
const RIM_HEX: Record<RimColor, { hex: string; metal: number; rough: number; clearCoat?: number }> = {
  chrome: { hex: "#f2f4f7", metal: 1, rough: 0.04 },
  black: { hex: "#141518", metal: 0, rough: 0.3, clearCoat: 1 },
  gold: { hex: "#e8b84a", metal: 1, rough: 0.14 },
  gunmetal: { hex: "#5a6068", metal: 1, rough: 0.28 },
  white: { hex: "#ececea", metal: 0, rough: 0.3, clearCoat: 1 },
  red: { hex: "#b5121f", metal: 0, rough: 0.28, clearCoat: 1 },
};

export interface TyreSpec {
  /** Rubber tube thickness (low profile = thinner). */
  thickness: number;
  /** Tread width multiplier along the axle. */
  width: number;
  /** Radius multiplier on top of the body's base wheel radius. */
  radiusScale: number;
}

export const TYRE_SPECS: Record<TyreId, TyreSpec> = {
  low: { thickness: 0.1, width: 1.7, radiusScale: 1 },
  standard: { thickness: 0.15, width: 1.6, radiusScale: 1 },
  offroad: { thickness: 0.22, width: 1.75, radiusScale: 1.1 },
  whitewall: { thickness: 0.15, width: 1.55, radiusScale: 1 },
};

/**
 * Builds one wheel under `parent`: tyre (spins around local Z), rim design and
 * hub. All geometry is generated around Y then baked onto Z, scaling before
 * rotating so every ring stays perfectly circular.
 */
export function buildWheel(scene: Scene, parent: TransformNode, radius: number, side: 1 | -1, tyre: TyreId, rim: RimId, rimColor: RimColor, key: string): Mesh {
  const spec = TYRE_SPECS[tyre];
  const r = radius * spec.radiusScale;
  const t = Math.min(spec.thickness, r * 0.6);
  const rubber = mat(scene, `tyre-${key}`, "#141416", { rough: 0.82, metal: 0 });
  const tyreMesh = MeshBuilder.CreateTorus("tyre", { diameter: r * 2 - t, thickness: t, tessellation: 56 }, scene);
  tyreMesh.scaling.y = spec.width;
  tyreMesh.rotation.x = Math.PI / 2;
  tyreMesh.bakeCurrentTransformIntoVertices();
  tyreMesh.material = rubber;
  tyreMesh.parent = parent;
  const face = side * (t * spec.width * 0.5);

  if (tyre === "offroad") {
    // Chunky tread blocks around the circumference.
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const lug = MeshBuilder.CreateBox("lug", { width: t * 0.55, height: t * 0.35, depth: t * spec.width * 1.05 }, scene);
      lug.position.set(Math.cos(a) * (r - t * 0.1), Math.sin(a) * (r - t * 0.1), 0);
      lug.rotation.z = a;
      lug.material = rubber;
      lug.parent = tyreMesh;
    }
  }
  if (tyre === "whitewall") {
    const wall = MeshBuilder.CreateTorus("whitewall", { diameter: r * 2 - t * 1.25, thickness: t * 0.28, tessellation: 56 }, scene);
    wall.rotation.x = Math.PI / 2;
    wall.bakeCurrentTransformIntoVertices();
    wall.position.z = face * 0.95;
    wall.material = mat(scene, `ww-${key}`, "#e9e7e0", { rough: 0.7 });
    wall.parent = tyreMesh;
  }

  const c = RIM_HEX[rimColor];
  const rimMat = mat(scene, `rim-${rimColor}-${key}`, c.hex, { metal: c.metal, rough: c.rough, clearCoat: c.clearCoat });
  rimMat.environmentIntensity = 1.8;
  const darkMat = mat(scene, `rimd-${key}`, "#24282e", { metal: 0.7, rough: 0.45 });
  const rimR = r - t + 0.03;
  const barrel = MeshBuilder.CreateCylinder("rim-barrel", { diameter: rimR * 2, height: t * spec.width * 0.9, tessellation: 48 }, scene);
  barrel.rotation.x = Math.PI / 2;
  barrel.bakeCurrentTransformIntoVertices();
  barrel.material = rim === "dish" || rim === "beadlock" ? rimMat : darkMat;
  barrel.parent = tyreMesh;

  const spokeZ = face * 0.75;
  const spoke = (count: number, width: number, angleOffset = 0, twist = 0, len = rimR) => {
    for (let k = 0; k < count; k++) {
      const s = MeshBuilder.CreateBox("spoke", { width: len, height: width, depth: 0.035 }, scene);
      s.setPivotPoint(new Vector3(-len / 2, 0, 0));
      s.position.set(len / 2, 0, spokeZ);
      s.rotation.z = angleOffset + (k * Math.PI * 2) / count;
      if (twist) s.rotation.x = twist;
      s.material = rimMat;
      s.parent = tyreMesh;
    }
  };
  switch (rim) {
    case "five":
      spoke(5, rimR * 0.32);
      break;
    case "six":
      spoke(6, rimR * 0.24);
      break;
    case "multi":
      spoke(10, rimR * 0.1);
      break;
    case "mesh":
      spoke(12, rimR * 0.07, 0.12);
      spoke(12, rimR * 0.07, -0.12);
      break;
    case "turbine":
      spoke(9, rimR * 0.2, 0, 0.6);
      break;
    case "wire":
      spoke(24, rimR * 0.03);
      break;
    case "dish": {
      const disc = MeshBuilder.CreateCylinder("dish", { diameter: rimR * 1.9, height: 0.03, tessellation: 40 }, scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.z = spokeZ;
      disc.material = rimMat;
      disc.parent = tyreMesh;
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI * 2) / 6;
        const hole = MeshBuilder.CreateCylinder("hole", { diameter: rimR * 0.32, height: 0.035, tessellation: 20 }, scene);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(Math.cos(a) * rimR * 0.58, Math.sin(a) * rimR * 0.58, spokeZ + side * 0.005);
        hole.material = darkMat;
        hole.parent = tyreMesh;
      }
      break;
    }
    case "beadlock": {
      spoke(6, rimR * 0.2);
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI * 2) / 12;
        const bolt = MeshBuilder.CreateSphere("bolt", { diameter: rimR * 0.12, segments: 6 }, scene);
        bolt.position.set(Math.cos(a) * rimR * 0.9, Math.sin(a) * rimR * 0.9, spokeZ);
        bolt.material = darkMat;
        bolt.parent = tyreMesh;
      }
      break;
    }
  }
  const hub = MeshBuilder.CreateCylinder("hub", { diameter: rimR * 0.42, height: 0.07, tessellation: 32 }, scene);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = spokeZ + side * 0.01;
  hub.material = rimMat;
  hub.parent = tyreMesh;
  return tyreMesh;
}

/**
 * Diecast paint finishes. Real toy cars are enamel over zinc alloy under a
 * clear lacquer: gloss = solid colour + clear coat, metallic = metal flake +
 * clear coat, pearl = flake with a colour shift, matte = no lacquer.
 */
export function paintFinish(m: PBRMaterial, finish: string): void {
  m.clearCoat.isEnabled = finish !== "matte";
  m.clearCoat.intensity = 1;
  m.clearCoat.roughness = 0.03;
  m.iridescence.isEnabled = false;
  switch (finish) {
    case "matte":
      m.metallic = 0;
      m.roughness = 0.62;
      break;
    case "metallic":
      m.metallic = 0.75;
      m.roughness = 0.32;
      break;
    case "pearl":
      m.metallic = 0.35;
      m.roughness = 0.28;
      m.iridescence.isEnabled = true;
      m.iridescence.intensity = 0.7;
      m.iridescence.indexOfRefraction = 1.4;
      m.iridescence.minimumThickness = 300;
      m.iridescence.maximumThickness = 600;
      break;
    default:
      m.metallic = 0;
      m.roughness = 0.38;
  }
}
