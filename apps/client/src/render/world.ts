import {
  Color3,
  Color4,
  CascadedShadowGenerator,
  DefaultRenderingPipeline,
  DepthOfFieldEffectBlurLevel,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  HDRCubeTexture,
  ImageProcessingConfiguration,
  Matrix,
  Mesh,
  MeshBuilder,
  PhotoDome,
  Quaternion,
  SSAO2RenderingPipeline,
  Scene,
  ShadowGenerator,
  PBRMaterial,
  Texture,
  TransformNode,
  UniversalCamera,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import { Rng, type Track } from "@rc/game-core";
import { Kit } from "./room/kit.js";
import { pbr, setTiling, surfaceMetres, scanTexture, type MatOpts, type SurfaceId } from "./materials.js";
import { buildRoom, roomFor, type Room } from "./room/rooms.js";
import { THEMES, type FloorKind, type ThemeStyle } from "./themes.js";

/** Game (x, y) on the floor plane → Babylon (x, height, y). */
export const toWorld = (x: number, y: number, h = 0) => new Vector3(x, h, y);

/** Physically based material (see render/materials.ts). */
export const mat = (scene: Scene, name: string, hex: string, opts: MatOpts = {}): PBRMaterial => pbr(scene, name, hex, opts);

const BARRIER_HEIGHT = 2.8; // above the 2.1 m jump apex, so cars visibly can't hop out
/** World metres covered by one repeat of the rug field pattern. */
const RUG_TILE = 18;

/**
 * Render quality. "high" adds ambient occlusion, depth of field and MSAA;
 * "low" (phones, or `?gfx=low`) keeps PBR + shadows only.
 */
export type Gfx = "high" | "low";

function pickGfx(): Gfx {
  try {
    const q = new URLSearchParams(location.search).get("gfx");
    if (q === "low" || q === "high") return q;
    const saved = localStorage.getItem("rc.gfx");
    if (saved === "low" || saved === "high") return saved;
  } catch {
    // storage blocked: fall through to the device guess
  }
  return navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900 ? "low" : "high";
}

const ENV_BASE = `${import.meta.env.BASE_URL}assets/env`;

/** Engine, scene, lights, chase camera and the current themed track. */
export class World {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly shadows: ShadowGenerator;
  readonly gfx: Gfx = pickGfx();
  private readonly sun: DirectionalLight;
  private readonly fill: HemisphericLight;
  private readonly pipeline: DefaultRenderingPipeline;
  private sky: PhotoDome | null = null;
  private readonly ssao: { name: string } | null;
  private camPos = new Vector3(0, 30, -30);
  private shakeAmount = 0;
  private camTarget = new Vector3(0, 0, 0);
  private trackRoot: TransformNode | null = null;
  private waterMats: PBRMaterial[] = [];
  track: Track | null = null;
  theme: ThemeStyle = THEMES["toy-track"];

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }, true);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new Scene(this.engine);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0018;
    this.scene.skipPointerMovePicking = true;
    this.camera = new UniversalCamera("chase", this.camPos.clone(), this.scene);
    this.camera.fov = 0.9;
    this.camera.minZ = 0.2;
    this.camera.maxZ = 1600;
    this.camera.inputs.clear();
    // Light comes mostly from the theme's HDRI (image-based lighting); one key
    // light (window sun / ceiling lamp) adds direction and the cast shadows.
    this.sun = new DirectionalLight("key", new Vector3(-0.45, -1, 0.35), this.scene);
    this.sun.position = new Vector3(200, 260, -120);
    // Bounce fill: light reflected off the floor onto the ceiling and the undersides of things.
    this.fill = new HemisphericLight("bounce", new Vector3(0, 1, 0), this.scene);
    this.fill.diffuse = new Color3(0.95, 0.93, 0.9);
    this.fill.groundColor = new Color3(0.75, 0.68, 0.6);
    this.fill.specular = Color3.Black();
    const high = this.gfx === "high";
    const csm = new CascadedShadowGenerator(high ? 2048 : 1024, this.sun);
    csm.numCascades = high ? 3 : 2;
    csm.lambda = 0.9;
    csm.shadowMaxZ = 420;
    csm.stabilizeCascades = true;
    csm.usePercentageCloserFiltering = true;
    csm.filteringQuality = high ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
    csm.bias = 0.004;
    csm.normalBias = 0.02;
    csm.darkness = 0;
    this.shadows = csm;

    const p = new DefaultRenderingPipeline("main", true, this.scene, [this.camera]);
    p.samples = high ? 4 : 1;
    p.fxaaEnabled = true;
    p.imageProcessingEnabled = true;
    p.imageProcessing.toneMappingEnabled = true;
    p.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    p.imageProcessing.exposure = 1.1;
    p.imageProcessing.contrast = 1.1;
    p.imageProcessing.vignetteEnabled = true;
    p.imageProcessing.vignetteWeight = 1.6;
    p.imageProcessing.vignetteStretch = 0.4;
    p.bloomEnabled = true;
    p.bloomThreshold = 0.92;
    p.bloomWeight = 0.22;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.grainEnabled = true;
    p.grain.intensity = 3.5;
    p.grain.animated = true;
    p.chromaticAberrationEnabled = high;
    p.chromaticAberration.aberrationAmount = 4;
    p.sharpenEnabled = true;
    p.sharpen.edgeAmount = 0.2;
    if (high) {
      // Macro-photo look: the diecast car is sharp, the room far behind softens.
      p.depthOfFieldEnabled = true;
      p.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Low;
      p.depthOfField.focalLength = 30;
      p.depthOfField.fStop = 3.2;
      p.depthOfField.lensSize = 50;
      const ssao = new SSAO2RenderingPipeline("ssao", this.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [this.camera]);
      ssao.radius = 1.6;
      ssao.totalStrength = 1.1;
      ssao.base = 0.15;
      ssao.samples = 16;
      ssao.maxZ = 260;
      ssao.expensiveBlur = true;
    }
    this.pipeline = p;
    this.ssao = high ? this.scene.postProcessRenderPipelineManager.supportedPipelines.find((x) => x.name === "ssao") ?? null : null;
    this.watchFrameRate();
    window.addEventListener("resize", () => this.engine.resize());
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const m of this.waterMats) {
        const tex = m.bumpTexture as Texture | null;
        if (tex) {
          tex.uOffset = (t * 0.015) % 1;
          tex.vOffset = (t * 0.009) % 1;
        }
      }
    });
  }

  /**
   * Adaptive quality: if the frame rate stays low, shed the most expensive
   * effects first (ambient occlusion, depth of field), then render resolution.
   * Never raises quality again mid-session, so it cannot oscillate.
   */
  private watchFrameRate(): void {
    let slow = 0;
    let step = 0;
    window.setInterval(() => {
      if (document.hidden) return;
      const fps = this.engine.getFps();
      slow = fps < 45 ? slow + 1 : 0;
      if (slow < 3) return;
      slow = 0;
      if (step === 0 && this.ssao) {
        this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", this.camera);
        this.pipeline.depthOfFieldEnabled = false;
      } else if (step <= 1) {
        this.pipeline.samples = 1;
        this.pipeline.chromaticAberrationEnabled = false;
      } else if (step <= 3) {
        this.engine.setHardwareScalingLevel(this.engine.getHardwareScalingLevel() * 1.2);
      } else return;
      step++;
    }, 1000);
  }

  /** Ground height under a game position (uses the track's height profile). */
  groundAt(x: number, y: number, hint = -1): { h: number; segment: number } {
    if (!this.track) return { h: 0, segment: -1 };
    const p = this.track.project(x, y, hint);
    return { h: this.track.heightAt(p.s), segment: p.segment };
  }

  /** Kick the chase camera (explosions nearby); decays over ~0.4 s. */
  shake(power: number): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + power);
  }

  /** Smooth chase camera behind a pose (height = ground + jump). */
  follow(x: number, y: number, height: number, heading: number, speed: number, dtSeconds: number, snap = false): void {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    // Close, low chase cam: diecast cars are small, the camera sits just above and behind.
    const back = 6.8 + Math.min(speed, 40) * 0.07;
    const desired = toWorld(x - fx * back, y - fy * back, height + 2.9 + speed * 0.02);
    const target = toWorld(x + fx * 7, y + fy * 7, height + 0.5);
    const k = snap ? 1 : 1 - Math.exp(-dtSeconds * 6);
    this.camPos = Vector3.Lerp(this.camPos, desired, k);
    this.camTarget = Vector3.Lerp(this.camTarget, target, snap ? 1 : 1 - Math.exp(-dtSeconds * 10));
    this.camera.position.copyFrom(this.camPos);
    if (this.shakeAmount > 0.01) {
      const a = this.shakeAmount * 0.6;
      this.camera.position.addInPlace(new Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
      this.shakeAmount *= Math.exp(-dtSeconds * 8);
    }
    this.camera.setTarget(this.camTarget);
    this.focusOn(toWorld(x, y, height + 0.5));
  }

  /** Depth of field focuses on a world point (millimetres in Babylon's lens model). */
  private focusOn(p: Vector3): void {
    if (this.pipeline.depthOfFieldEnabled) this.pipeline.depthOfField.focusDistance = Vector3.Distance(this.camera.position, p) * 1000;
  }

  /** Fixed product-shot camera: `dist` away at `height`, offset sideways so a side panel doesn't cover the subject. */
  lookAt(x: number, y: number, z: number, dist: number, height: number, side: number): void {
    this.camera.position.copyFrom(toWorld(x + dist * 0.75, y + dist * 0.65 + side, z + height));
    this.camera.setTarget(toWorld(x, y + side * 0.6, z));
    this.focusOn(toWorld(x, y, z));
  }

  /** Overview camera for lobby/results. */
  orbit(t: number): void {
    const track = this.track;
    if (!track) return;
    const cx = track.xs.reduce((a, b) => a + b, 0) / track.count;
    const cy = track.ys.reduce((a, b) => a + b, 0) / track.count;
    this.camera.position.copyFrom(toWorld(cx + Math.cos(t * 0.05) * 260, cy + Math.sin(t * 0.05) * 260, 150));
    this.camera.setTarget(toWorld(cx, cy, 0));
    this.focusOn(toWorld(cx, cy, 0));
  }

  /** Screen-space position of a world point (for name tags), or null if behind the camera. */
  project(p: Vector3): { x: number; y: number } | null {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const v = Vector3.Project(p, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    if (v.z < 0 || v.z > 1) return null;
    const scale = this.engine.getHardwareScalingLevel();
    return { x: v.x * scale, y: v.y * scale };
  }

  /** (Re)builds the whole themed track. Safe to call when the map changes between matches. */
  setTrack(track: Track): void {
    if (this.track === track) return;
    this.trackRoot?.dispose(false, true);
    this.waterMats = [];
    this.track = track;
    this.theme = THEMES[track.def.theme];
    const root = new TransformNode(`track:${track.def.id}`, this.scene);
    this.trackRoot = root;
    this.scene.clearColor = Color4.FromHexString(`${this.theme.clear}ff`);
    this.scene.fogColor = Color3.FromHexString(this.theme.fog);
    this.scene.fogDensity = this.theme.fogDensity;
    this.sun.intensity = this.theme.sunIntensity * 3;
    this.fill.intensity = this.theme.outdoor ? 0.15 : 0.35;
    this.setEnvironment(track.def.theme, root);

    const bounds = trackBounds(track);
    const room = roomFor(bounds, this.theme.outdoor);
    this.buildFloor(track, bounds, root, room);
    this.buildSurface(track, bounds, root);
    this.buildSkirts(track, root);
    this.buildBarriers(track, root);
    if (this.theme.pillars) this.buildPillars(track, root);
    this.buildWater(track, root);
    this.buildRamps(track, root);
    this.buildStartLine(track, root);
    // The room around the circuit: walls, windows, furniture, clutter.
    const kit = new Kit(this.scene, root, this.shadows);
    buildRoom(kit, track, room);
    // Static geometry never changes material state: freezing skips per-frame shader checks.
    kit.freezeMaterials();
    for (const m of root.getChildMeshes(false)) if (m.material instanceof PBRMaterial && !this.waterMats.includes(m.material)) m.material.freeze();
  }

  /** HDRI image-based lighting for the theme; outdoors also the photographed sky. */
  private setEnvironment(theme: string, root: TransformNode): void {
    const prev = this.scene.environmentTexture;
    const env = new HDRCubeTexture(`${ENV_BASE}/${theme}.hdr`, this.scene, 256, false, true, false, true);
    env.rotationY = 0.6;
    this.scene.environmentTexture = env;
    this.scene.environmentIntensity = this.theme.envIntensity * 1.4;
    prev?.dispose();
    this.sky?.dispose();
    this.sky = null;
    if (this.theme.outdoor) {
      const dome = new PhotoDome("sky", `${ENV_BASE}/${theme}-sky.webp`, { resolution: 48, size: 3000 }, this.scene);
      dome.mesh.applyFog = false;
      dome.mesh.infiniteDistance = true;
      dome.parent = root;
      this.sky = dome;
    }
  }

  // ------------------------------------------------------------------ floor + surface

  private buildFloor(track: Track, b: Bounds, root: TransformNode, room: Room): void {
    // Indoors the floor ends at the walls; outdoors the lawn/sand runs to the horizon.
    const w = this.theme.outdoor ? room.x1 - room.x0 + 1600 : room.x1 - room.x0;
    const d = this.theme.outdoor ? room.y1 - room.y0 + 1600 : room.y1 - room.y0;
    const floor = MeshBuilder.CreateGround("floor", { width: w, height: d }, this.scene);
    floor.position = toWorld((room.x0 + room.x1) / 2, (room.y0 + room.y1) / 2, -0.02);
    const size = floorRepeat(this.theme.floor);
    floor.material = floorMaterial(this.scene, "floor", this.theme.floor, [w / size, d / size]);
    floor.receiveShadows = true;
    floor.parent = root;

    if (this.theme.surface === "rug") {
      // The rug lies under the whole circuit: a finely tiled field plus a woven border band.
      const w = b.maxX - b.minX + 60;
      const d = b.maxY - b.minY + 60;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const rug = MeshBuilder.CreateGround("rug", { width: w, height: d }, this.scene);
      rug.position = toWorld(cx, cy, 0.01);
      const field = rugFabric(this.scene, "rug-field", rugTexture(this.scene));
      setTiling(field, w / RUG_TILE, d / RUG_TILE);
      rug.material = field;
      rug.receiveShadows = true;
      rug.parent = root;
      const borderMat = rugFabric(this.scene, "rug-border", rugBorderTexture(this.scene));
      setTiling(borderMat, Math.max(w, d) / 18, 1);
      const band = 9;
      for (const [bw, bd, x, y, rot] of [
        [w, band, cx, cy - d / 2 + band / 2, 0],
        [w, band, cx, cy + d / 2 - band / 2, Math.PI],
        [d, band, cx - w / 2 + band / 2, cy, Math.PI / 2],
        [d, band, cx + w / 2 - band / 2, cy, -Math.PI / 2],
      ] as const) {
        const strip = MeshBuilder.CreateGround("rug-border", { width: bw, height: bd }, this.scene);
        strip.position = toWorld(x, y, 0.02);
        strip.rotation.y = rot;
        strip.material = borderMat;
        strip.receiveShadows = true;
        strip.parent = root;
      }
    }
    void track;
  }

  private rugMat: PBRMaterial | null = null;
  /** The rug material is disposed with its track; rebuild it for the next one. */
  private rugTrack: Track | null = null;
  private rugMaterial(): PBRMaterial {
    if (this.rugMat && this.rugMat.getScene() === this.scene && this.rugTrack === this.track) return this.rugMat;
    const m = rugFabric(this.scene, "rug-surface", rugTexture(this.scene));
    this.rugMat = m;
    this.rugTrack = this.track;
    return m;
  }

  /** The racing surface. Rug and tiles continue the floor pattern (no visible road); toy tracks are plastic strips. */
  private buildSurface(track: Track, b: Bounds, root: TransformNode): void {
    const left = track.boundary3(1);
    const right = track.boundary3(-1);
    const path = (pts: typeof left) => pts.map((p) => toWorld(p.x, p.y, p.z + 0.03));
    const uvs: Vector2[] = [];
    const style = this.theme.surface;
    const floorSize = floorRepeat(this.theme.floor);
    const dirtSize = surfaceMetres("dirt") * DIRT_SCALE;
    for (const [pts, side] of [[left, 0], [right, 1]] as const) {
      for (const p of pts) {
        if (style === "rug") uvs.push(new Vector2(p.x / RUG_TILE, p.y / RUG_TILE));
        // "floor": the floor pattern simply continues under the racing line — no road at all.
        else if (style === "floor") uvs.push(new Vector2(p.x / floorSize, p.y / floorSize));
        else if (style === "dirt") uvs.push(new Vector2(p.s / dirtSize, (side * track.def.width) / dirtSize));
        else uvs.push(new Vector2(p.s / 8, side));
      }
    }
    const surface = MeshBuilder.CreateRibbon("surface", { pathArray: [path(left), path(right)], uvs, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    let m: PBRMaterial;
    if (style === "rug") m = this.rugMaterial();
    else if (style === "floor") m = floorMaterial(this.scene, "surface-floor", this.theme.floor, 1);
    else if (style === "dirt") m = mat(this.scene, "surface-dirt", "#ffffff", { surface: "dirt", tint: false, tiling: 1, detail: 12 });
    else {
      // Injection-moulded toy track: smooth, slightly glossy plastic.
      m = mat(this.scene, `surface-${style}`, "#ffffff", { rough: 0.3 });
      m.albedoTexture = plasticTrackTexture(this.scene, style === "plastic-orange" ? "#ff6a10" : "#1f6fd6");
    }
    surface.material = m;
    surface.receiveShadows = true;
    surface.parent = root;
  }

  /** Sides of raised sections, down to the floor (rug draped over cushions, a wooden tray…). */
  private buildSkirts(track: Track, root: TransformNode): void {
    if (this.theme.skirt === "none" || track.elevationStats().max < 0.05) return;
    const skirtScan = { wood: ["wood", "#b98450"], grass: ["lawn", "#ffffff"], sand: ["sand", "#ffffff"] } as const;
    let m: PBRMaterial;
    if (this.theme.skirt === "rug") m = this.rugMaterial();
    else {
      const [id, hex] = skirtScan[this.theme.skirt];
      m = mat(this.scene, `skirt-${this.theme.skirt}`, hex, { surface: id, tint: id === "wood", tiling: [track.length / surfaceMetres(id), 0.1] });
    }
    for (const side of [1, -1] as const) {
      const edge = track.boundary3(side, -0.01);
      const top = edge.map((p) => toWorld(p.x, p.y, p.z + 0.02));
      const bottom = edge.map((p) => toWorld(p.x, p.y, 0));
      const skirt = MeshBuilder.CreateRibbon(`skirt${side}`, { pathArray: [top, bottom], sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      skirt.material = m;
      skirt.parent = root;
    }
  }

  // ------------------------------------------------------------------ barriers

  private buildBarriers(track: Track, root: TransformNode): void {
    if (this.theme.barrier === "rail") this.buildRails(track, root);
    else this.buildBlocks(track, root);
  }

  /** Low plastic side rails plus a clear guard panel showing where the wall really is. */
  private buildRails(track: Track, root: TransformNode): void {
    const rail = MeshBuilder.CreateBox("rail", { size: 1 }, this.scene);
    rail.material = mat(this.scene, "rail", this.theme.railColor, { rough: 0.3 });
    const guard = MeshBuilder.CreateBox("guard", { size: 1 }, this.scene);
    const gm = mat(this.scene, "guard", "#d8f0ff", { alpha: 0.1, specular: 0.9 });
    gm.backFaceCulling = false;
    guard.material = gm;
    for (const side of [1, -1] as const) {
      const pts = track.boundary3(side, -0.3);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        addSegment(rail, a, b, 0.55, 0.45);
        addSegment(guard, a, b, BARRIER_HEIGHT, 0.05);
      }
    }
    for (const m of [rail, guard]) {
      m.thinInstanceRefreshBoundingInfo();
      m.parent = root;
    }
    this.shadows.addShadowCaster(rail);
  }

  /** Rows of toy building blocks in alternating colours. */
  private buildBlocks(track: Track, root: TransformNode): void {
    const [bw, bh, bd] = this.theme.block;
    const vary = this.theme.blockVariation;
    const rng = new Rng(track.def.id.length * 31 + 5);
    const bases = this.theme.barrierColors.map((c, i) => {
      const box = MeshBuilder.CreateBox(`block${i}`, { width: bw, height: 1, depth: bd }, this.scene);
      // Lacquered wooden toy blocks, stones or leather-bound books, by theme.
      const id = this.theme.blockSurface;
      box.material = mat(this.scene, `block${i}`, c, { surface: id, clearCoat: id === "oak" ? 0.7 : 0, tiling: 0.3 });
      box.parent = root;
      return box;
    });
    let k = 0;
    for (const side of [1, -1] as const) {
      const pts = track.boundary3(side, -0.9);
      let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const pitch = bw + 0.15;
        for (let d = carry; d < len; d += pitch) {
          const f = d / len;
          const x = a.x + (b.x - a.x) * f;
          const y = a.y + (b.y - a.y) * f;
          const z = a.z + (b.z - a.z) * f;
          // Height varies for books/stones, but never below the jump-proof barrier height.
          const h = Math.max(BARRIER_HEIGHT, bh * (1 + rng.range(0, vary)));
          const m = Matrix.Compose(new Vector3(1, h, 1), Quaternion.RotationAxis(Vector3.Up(), -angle + rng.range(-vary, vary) * 0.3), toWorld(x, y, z + h / 2));
          bases[k++ % bases.length]!.thinInstanceAdd(m, false);
          carry = d + pitch - len;
        }
      }
    }
    for (const base of bases) {
      base.thinInstanceRefreshBoundingInfo();
      this.shadows.addShadowCaster(base);
    }
  }

  /** Toy-track stands under raised plastic track. */
  private buildPillars(track: Track, root: TransformNode): void {
    const pillar = MeshBuilder.CreateCylinder("pillar", { diameter: 0.9, height: 1, tessellation: 12 }, this.scene);
    pillar.material = mat(this.scene, "pillar", "#f5c400", { rough: 0.35 });
    pillar.parent = root;
    for (let i = 0; i < track.count; i += 6) {
      const z = track.zs[i]!;
      if (z < 0.6) continue;
      for (const side of [1, -1]) {
        const off = (track.halfWidth - 0.6) * side;
        const x = track.xs[i]! - track.ty[i]! * off;
        const y = track.ys[i]! + track.tx[i]! * off;
        pillar.thinInstanceAdd(Matrix.Compose(new Vector3(1, z, 1), Quaternion.Identity(), toWorld(x, y, z / 2)), false);
      }
    }
    pillar.thinInstanceRefreshBoundingInfo();
    this.shadows.addShadowCaster(pillar);
  }

  // ------------------------------------------------------------------ water, ramps, start

  private buildWater(track: Track, root: TransformNode): void {
    if (track.waterRanges.length === 0) return;
    // Clear water: almost no colour of its own, a mirror-smooth surface with slow ripples.
    const m = mat(this.scene, "water", this.theme.water, { alpha: this.theme.waterAlpha, rough: 0.04, metal: 0 });
    const ripples = scanTexture(this.scene, "plaster", "normal");
    ripples.uScale = 6;
    ripples.vScale = 6;
    ripples.level = 0.35;
    m.bumpTexture = ripples;
    m.indexOfRefraction = 1.33;
    this.waterMats.push(m);
    const left = track.boundary3(1, 0.2);
    const right = track.boundary3(-1, 0.2);
    for (const w of track.waterRanges) {
      const pick = (pts: typeof left) => pts.filter((p) => p.s >= w.from && p.s <= w.to).map((p) => toWorld(p.x, p.y, p.z + 0.14));
      const l = pick(left);
      const r = pick(right);
      if (l.length < 2 || r.length < 2) continue;
      const sheet = MeshBuilder.CreateRibbon("water", { pathArray: [l, r], sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      sheet.material = m;
      sheet.parent = root;
      if (this.theme.pond) {
        // A spill / tray of water spreading off both sides of the crossing.
        const mid = track.poseAt((w.from + w.to) / 2);
        const pond = MeshBuilder.CreateDisc("pond", { radius: (w.to - w.from) * 0.32 + 8, tessellation: 48 }, this.scene);
        pond.rotation.x = Math.PI / 2;
        pond.position = toWorld(mid.x, mid.y, track.heightAt((w.from + w.to) / 2) + 0.06);
        pond.material = m;
        pond.parent = root;
      }
    }
  }

  private buildRamps(track: Track, root: TransformNode): void {
    const m = mat(this.scene, "ramp", this.theme.ramp, { surface: "wood", clearCoat: 0.5, tiling: 0.15 });
    for (const s of track.rampS) {
      const length = 6;
      const lift = 0.7;
      const pose = track.poseAt(s - length / 2);
      const ramp = MeshBuilder.CreateBox("ramp", { width: length, height: 0.22, depth: track.def.width - 3 }, this.scene);
      ramp.rotationQuaternion = Quaternion.RotationYawPitchRoll(-pose.heading, 0, Math.atan2(lift, length));
      ramp.position = toWorld(pose.x, pose.y, track.heightAt(s - length / 2) + lift / 2);
      ramp.material = m;
      ramp.parent = root;
      ramp.receiveShadows = true;
      this.shadows.addShadowCaster(ramp);
    }
  }

  private buildStartLine(track: Track, root: TransformNode): void {
    const scene = this.scene;
    const g = track.gates[0]!;
    const z = track.heightAt(0);
    const tex = new DynamicTexture("checker", { width: 256, height: 64 }, scene, false);
    const c = tex.getContext() as CanvasRenderingContext2D;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      c.fillStyle = (x + y) % 2 === 0 ? "#f2f2f2" : "#111";
      c.fillRect(x * 16, y * 16, 16, 16);
    }
    tex.update();
    const line = MeshBuilder.CreateGround("startline", { width: track.halfWidth * 2, height: 2 }, scene);
    const m = mat(scene, "checker", "#ffffff", { rough: 0.6 });
    m.albedoTexture = tex;
    line.material = m;
    const angle = Math.atan2(g.ty, g.tx);
    line.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -angle + Math.PI / 2);
    const mid = { x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 };
    line.position = toWorld(mid.x, mid.y, z + 0.05);
    line.parent = root;

    const pillarMat = mat(scene, "arch", "#3a3f47", { rough: 0.35, metal: 1 });
    for (const end of [{ x: g.ax, y: g.ay }, { x: g.bx, y: g.by }]) {
      const p = MeshBuilder.CreateBox("arch-pillar", { width: 0.8, height: 7, depth: 0.8 }, scene);
      p.position = toWorld(end.x, end.y, z + 3.5);
      p.material = pillarMat;
      p.parent = root;
      this.shadows.addShadowCaster(p);
    }
    const bannerTex = new DynamicTexture("banner", { width: 1024, height: 128 }, scene, true);
    const bc = bannerTex.getContext() as CanvasRenderingContext2D;
    bc.fillStyle = "#ffc933";
    bc.fillRect(0, 0, 1024, 128);
    bc.fillStyle = "#1b1500";
    bc.font = "bold 72px 'Chakra Petch', Arial, sans-serif";
    bc.textAlign = "center";
    bc.textBaseline = "middle";
    bc.fillText(track.def.name.toUpperCase(), 512, 68);
    bannerTex.update();
    const banner = MeshBuilder.CreatePlane("banner", { width: Math.hypot(g.bx - g.ax, g.by - g.ay), height: 1.6, sideOrientation: Mesh.DOUBLESIDE }, scene);
    const bm = mat(scene, "banner", "#ffffff", { rough: 0.7 });
    bm.albedoTexture = bannerTex;
    banner.material = bm;
    banner.position = toWorld(mid.x, mid.y, z + 6.6);
    banner.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -angle + Math.PI / 2);
    banner.parent = root;
  }

  dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}

// ------------------------------------------------------------------ helpers

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function trackBounds(track: Track): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < track.count; i++) {
    minX = Math.min(minX, track.xs[i]!); maxX = Math.max(maxX, track.xs[i]!);
    minY = Math.min(minY, track.ys[i]!); maxY = Math.max(maxY, track.ys[i]!);
  }
  return { minX, minY, maxX, maxY };
}

/** Thin-instance box stretched from a to b (following the slope), `height` tall. */
function addSegment(base: Mesh, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, height: number, thickness: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const yaw = -Math.atan2(b.y - a.y, b.x - a.x);
  const pitch = Math.atan2(b.z - a.z, len);
  const m = Matrix.Compose(
    new Vector3(Math.hypot(len, b.z - a.z) + 0.05, height, thickness),
    Quaternion.RotationYawPitchRoll(yaw, 0, pitch),
    toWorld((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2 + height / 2),
  );
  base.thinInstanceAdd(m, false);
}

function canvasTexture(scene: Scene, name: string, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  draw(tex.getContext() as CanvasRenderingContext2D, size);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/**
 * Photo-scanned floor per kind; carpets are tinted greyscale wool. `grain` is
 * the fine detail layered on top (natural surfaces reuse their own scan).
 */
const FLOOR_SCAN: Record<FloorKind, { id: SurfaceId; tint?: string; rough?: number; grain?: SurfaceId; scale?: number }> = {
  planks: { id: "laminate", grain: "oak" },
  carpet: { id: "carpet", tint: "#6c7c98" },
  tiles: { id: "floor-tiles", rough: 0.55, grain: "plaster" },
  mosaic: { id: "mosaic", rough: 0.5, grain: "plaster" },
  grass: { id: "lawn", scale: 0.35 },
  concrete: { id: "garage-concrete", scale: 0.5 },
  parquet: { id: "parquet", rough: 0.8, grain: "oak" },
  sand: { id: "sand", scale: 0.35 },
  pinkcarpet: { id: "carpet", tint: "#d79aae" },
};

/**
 * World metres per floor texture repeat. Man-made floors keep their real
 * size (a plank must look like a plank); natural ground has no fixed scale,
 * so it is shrunk to get more texels where the toy-height camera looks.
 */
const floorRepeat = (kind: FloorKind): number => surfaceMetres(FLOOR_SCAN[kind].id) * (FLOOR_SCAN[kind].scale ?? 1);
/** Same idea for the garden's dirt path. */
const DIRT_SCALE = 0.3;

function floorMaterial(scene: Scene, name: string, kind: FloorKind, tiling: number | [number, number]): PBRMaterial {
  const f = FLOOR_SCAN[kind];
  return pbr(scene, name, f.tint ?? "#ffffff", { surface: f.id, tint: f.tint !== undefined, rough: f.rough, tiling, detail: 12, detailSurface: f.grain });
}

/** Woven rug: the pattern as colour, wool weave as normal/roughness. */
function rugFabric(scene: Scene, name: string, pattern: Texture): PBRMaterial {
  const m = pbr(scene, name, "#ffffff", { surface: "carpet", tint: false, tiling: 1 });
  m.albedoTexture = pattern;
  m.metallic = 0;
  return m;
}

/**
 * Persian-style rug field, one tileable repeat (RUG_TILE m): a madder-red
 * ground with a lattice of small flowers and vines in muted wool dyes, then
 * per-pixel fibre noise and abrash (slow dye-lot banding) so it reads as wool.
 */
function rugTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, "rug", 1024, (c, s) => {
    c.fillStyle = "#6a1f22";
    c.fillRect(0, 0, s, s);
    const cell = s / 4;
    const motif = (x: number, y: number) => {
      // Lattice diamond in navy, outlined in ivory.
      c.save();
      c.translate(x, y);
      c.strokeStyle = "rgba(214,196,158,0.55)";
      c.lineWidth = 5;
      c.fillStyle = "#24304a";
      c.beginPath();
      c.moveTo(0, -cell * 0.32);
      c.lineTo(cell * 0.32, 0);
      c.lineTo(0, cell * 0.32);
      c.lineTo(-cell * 0.32, 0);
      c.closePath();
      c.fill();
      c.stroke();
      // Eight-petal rosette.
      for (let i = 0; i < 8; i++) {
        c.rotate(Math.PI / 4);
        c.fillStyle = i % 2 ? "#b98d4a" : "#c9b48a";
        c.beginPath();
        c.ellipse(0, cell * 0.13, cell * 0.035, cell * 0.08, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = "#7d2a24";
      c.beginPath();
      c.arc(0, 0, cell * 0.05, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) motif(i * cell, j * cell);
    // Vines joining the lattice.
    c.strokeStyle = "rgba(185,141,74,0.6)";
    c.lineWidth = 3;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * cell + cell / 2;
      const y = j * cell + cell / 2;
      c.beginPath();
      for (let k = 0; k <= 24; k++) {
        const t = (k / 24) * Math.PI * 2;
        c.lineTo(x + Math.cos(t) * cell * 0.22, y + Math.sin(t * 2) * cell * 0.08);
      }
      c.stroke();
      c.fillStyle = "#3f5a4a";
      for (const [dx, dy] of [[-0.22, 0], [0.22, 0], [0, -0.1], [0, 0.1]] as const) {
        c.beginPath();
        c.ellipse(x + dx * cell, y + dy * cell, 7, 4, dx ? 0.6 : -0.6, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Fibre noise and abrash.
    const img = c.getImageData(0, 0, s, s);
    const d = img.data;
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < s; y++) {
      const band = 1 + Math.sin((y / s) * Math.PI * 6) * 0.04;
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const n = (0.86 + rnd() * 0.22) * band;
        d[i] = Math.min(255, d[i]! * n);
        d[i + 1] = Math.min(255, d[i + 1]! * n);
        d[i + 2] = Math.min(255, d[i + 2]! * n);
      }
    }
    c.putImageData(img, 0, 0);
  });
}

/** Woven border band for the rug edges (repeats along its length). */
function rugBorderTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, "rug-border", 256, (c, s) => {
    c.fillStyle = "#24304a";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "#b98d4a";
    c.fillRect(0, s * 0.18, s, s * 0.1);
    c.fillRect(0, s * 0.72, s, s * 0.1);
    c.fillStyle = "#6a1f22";
    for (let x = 0; x < s; x += s / 4) {
      c.beginPath();
      c.moveTo(x + s / 8, s * 0.32);
      c.lineTo(x + s / 4, s * 0.5);
      c.lineTo(x + s / 8, s * 0.68);
      c.lineTo(x, s * 0.5);
      c.closePath();
      c.fill();
    }
  });
}

/** Toy track strip: coloured plastic with guide grooves; u runs along the track. */
function plasticTrackTexture(scene: Scene, color: string): DynamicTexture {
  return canvasTexture(scene, `plastic-${color}`, 256, (c, s) => {
    c.fillStyle = color;
    c.fillRect(0, 0, s, s);
    c.fillStyle = "rgba(0,0,0,0.12)";
    c.fillRect(0, s * 0.3, s, s * 0.04);
    c.fillRect(0, s * 0.66, s, s * 0.04);
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.fillRect(0, 6, s, 8);
    c.fillRect(0, s - 14, s, 8);
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.fillRect(s - 3, 0, 3, s); // piece joint every 8 m
  });
}
