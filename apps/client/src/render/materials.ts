import { Color3, PBRMaterial, Texture, type Scene } from "@babylonjs/core";

/**
 * Physically based materials for everything in the world.
 *
 * Every surface is a PBRMaterial lit by the theme's HDRI (image-based
 * lighting), so paint, plastic, chrome, wood and fabric respond to light the
 * way the real things do. Photo-scanned CC0 materials from Poly Haven
 * (apps/client/public/assets/pbr, fetched by scripts/fetch-assets.py) give
 * floors, walls and furniture real grain, weave and roughness.
 */

/** Real-world size of one texture repeat in cm (from the asset manifest). */
export const SURFACES = {
  laminate: 170,
  carpet: 27,
  "floor-tiles": 190,
  mosaic: 200,
  lawn: 200,
  "garage-concrete": 189,
  parquet: 340,
  sand: 150,
  dirt: 300,
  plaster: 200,
  "wall-tiles": 127,
  "block-wall": 200,
  panelling: 140,
  wood: 60,
  "wood-fine": 60,
  oak: 100,
  linen: 27,
  velvet: 28,
  fleece: 27,
  leather: 40,
  bark: 100,
  rock: 200,
  granite: 230,
} as const;

export type SurfaceId = keyof typeof SURFACES;

/** Game metres per real centimetre (the diecast cars are ~3.6 cm toys simulated as 2.6 m). */
export const REAL_CM = 0.72;

/** Game metres covered by one repeat of a surface texture. */
export const surfaceMetres = (id: SurfaceId): number => SURFACES[id] * REAL_CM;

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/pbr`;

export interface MatOpts {
  /** 0 = mirror, 1 = fully diffuse. Derived from the legacy specular settings when absent. */
  rough?: number;
  metal?: number;
  alpha?: number;
  /** Self-illumination strength (lamps, LEDs, screens). */
  emissive?: number;
  /** Clear lacquer layer on top (car paint, varnished wood, glazed ceramic). */
  clearCoat?: number;
  /** Photo-scanned material. With `tint` (default) the scan's greyscale detail is coloured by `hex`. */
  surface?: SurfaceId;
  tint?: boolean;
  /**
   * How the mesh's UVs are measured. "metres" (Kit furniture, box-projected
   * UVs) tiles the scan at its real size; a number repeats it that many
   * times over 0..1 UVs.
   */
  tiling?: "metres" | number | [number, number];
  /**
   * Add the scan again as a Babylon detail map, repeated this many times
   * more finely. Floors seen from a 3.6 cm car's height need it: one
   * 1k texture over 1-2 m of real floor is far too coarse up close.
   */
  detail?: number;
  /** Detail from a different scan (e.g. fine plaster grain on tiles instead of miniature tiles). */
  detailSurface?: SurfaceId;
  /** Legacy Blinn-Phong inputs, mapped to roughness/metalness. */
  specular?: number;
  specularPower?: number;
}

/** Map old specular strength/power to roughness and metalness. */
function fromLegacy(c: Color3, spec = 0.2, power = 32): { rough: number; metal: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const sat = max > 0 ? (max - min) / max : 0;
  // Only near-mirror greys are bare metal (steel, chrome); glossy enamel (fridges, ceramics) stays dielectric.
  const metal = spec >= 0.95 && power >= 90 && sat < 0.15 && max > 0.35 ? 1 : 0;
  const rough = Math.min(0.95, Math.max(0.08, 0.95 - spec * 0.45 - (Math.log2(Math.max(power, 2)) / 7) * 0.35));
  return { rough, metal };
}

type ScanKind = "albedo" | "detail" | "normal" | "orm" | "detailmap";
const scans = new WeakMap<Scene, Map<string, Texture>>();

/** One scan texture per scene, cloned per material so each can tile differently (clones share the GPU texture). */
export function scanTexture(scene: Scene, id: SurfaceId, kind: ScanKind): Texture {
  let cache = scans.get(scene);
  if (!cache) {
    cache = new Map();
    scans.set(scene, cache);
  }
  const key = `${id}/${kind}`;
  let base = cache.get(key);
  if (!base) {
    base = new Texture(`${ASSET_BASE}/${id}/${kind}.webp`, scene, { noMipmap: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE });
    base.anisotropicFilteringLevel = 8;
    if (kind !== "albedo" && kind !== "detail") base.gammaSpace = false;
    cache.set(key, base);
  }
  const t = base.clone();
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** Set how often every texture of a material repeats. */
export function setTiling(m: PBRMaterial, u: number, v = u): void {
  for (const t of [m.albedoTexture, m.bumpTexture, m.metallicTexture]) {
    if (t instanceof Texture) {
      t.uScale = u;
      t.vScale = v;
    }
  }
}

export function pbr(scene: Scene, name: string, hex: string, o: MatOpts = {}): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  const srgb = Color3.FromHexString(hex);
  const legacy = fromLegacy(srgb, o.specular, o.specularPower);
  m.albedoColor = srgb.toLinearSpace();
  m.metallic = o.metal ?? legacy.metal;
  m.roughness = o.rough ?? legacy.rough;
  // Babylon's default PBR reflectance at F0 matches common dielectrics (4%); keep it.
  if (o.emissive) {
    m.emissiveColor = srgb.toLinearSpace().scale(o.emissive * 2.2);
  }
  if (o.alpha !== undefined && o.alpha < 1) {
    m.alpha = o.alpha;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.backFaceCulling = false;
  }
  if (o.clearCoat) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = o.clearCoat;
    m.clearCoat.roughness = 0.04;
  }
  if (o.surface) {
    const tint = o.tint ?? true;
    m.albedoTexture = scanTexture(scene, o.surface, tint ? "detail" : "albedo");
    if (!tint) m.albedoColor = Color3.White();
    m.bumpTexture = scanTexture(scene, o.surface, "normal");
    m.metallicTexture = scanTexture(scene, o.surface, "orm");
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    // The ORM map carries the real roughness; the factor scales it (lacquer/glaze = lower).
    m.roughness = o.rough ?? 1;
    m.metallic = o.metal ?? 1;
    const tiling = o.tiling ?? "metres";
    if (tiling === "metres") setTiling(m, 1 / surfaceMetres(o.surface));
    else if (typeof tiling === "number") setTiling(m, tiling);
    else setTiling(m, tiling[0], tiling[1]);
    if (o.detail) {
      const base = m.albedoTexture as Texture;
      const d = scanTexture(scene, o.detailSurface ?? o.surface, "detailmap");
      d.uScale = base.uScale * o.detail;
      d.vScale = base.vScale * o.detail;
      m.detailMap.texture = d;
      m.detailMap.isEnabled = true;
      m.detailMap.diffuseBlendLevel = 0.45;
      m.detailMap.roughnessBlendLevel = 0.35;
      m.detailMap.bumpLevel = 0.9;
    }
  }
  return m;
}
