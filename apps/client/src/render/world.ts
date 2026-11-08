import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  UniversalCamera,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import { Rng, type Track } from "@rc/game-core";
import { THEMES, type ThemeStyle } from "./themes.js";

/** Game (x, y) on the floor plane → Babylon (x, height, y). */
export const toWorld = (x: number, y: number, h = 0) => new Vector3(x, h, y);

export function mat(scene: Scene, name: string, hex: string, opts: { emissive?: number; specular?: number; alpha?: number; specularPower?: number } = {}): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = new Color3(opts.specular ?? 0.15, opts.specular ?? 0.15, opts.specular ?? 0.15);
  if (opts.specularPower) m.specularPower = opts.specularPower;
  if (opts.emissive) m.emissiveColor = c.scale(opts.emissive);
  if (opts.alpha !== undefined) m.alpha = opts.alpha;
  return m;
}

const BARRIER_HEIGHT = 2.8; // above the 2.1 m jump apex, so cars visibly can't hop out
/** World metres covered by one repeat of the rug field pattern. */
const RUG_TILE = 18;

/** Engine, scene, lights, chase camera and the current themed track. */
export class World {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly shadows: ShadowGenerator;
  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  private camPos = new Vector3(0, 30, -30);
  private camTarget = new Vector3(0, 0, 0);
  private trackRoot: TransformNode | null = null;
  private waterMats: StandardMaterial[] = [];
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
    this.hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    this.hemi.intensity = 0.8;
    this.hemi.groundColor = new Color3(0.22, 0.18, 0.15);
    this.sun = new DirectionalLight("lamp", new Vector3(-0.4, -1, 0.3), this.scene);
    this.sun.position = new Vector3(200, 260, -120);
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 12;
    this.shadows.darkness = 0.4;
    window.addEventListener("resize", () => this.engine.resize());
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const m of this.waterMats) {
        const tex = m.diffuseTexture as Texture | null;
        if (tex) tex.uOffset = (t * 0.03) % 1;
      }
    });
  }

  /** Ground height under a game position (uses the track's height profile). */
  groundAt(x: number, y: number, hint = -1): { h: number; segment: number } {
    if (!this.track) return { h: 0, segment: -1 };
    const p = this.track.project(x, y, hint);
    return { h: this.track.heightAt(p.s), segment: p.segment };
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
    this.camera.setTarget(this.camTarget);
  }

  /** Overview camera for lobby/results. */
  orbit(t: number): void {
    const track = this.track;
    if (!track) return;
    const cx = track.xs.reduce((a, b) => a + b, 0) / track.count;
    const cy = track.ys.reduce((a, b) => a + b, 0) / track.count;
    this.camera.position.copyFrom(toWorld(cx + Math.cos(t * 0.05) * 260, cy + Math.sin(t * 0.05) * 260, 150));
    this.camera.setTarget(toWorld(cx, cy, 0));
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
    this.sun.intensity = this.theme.sunIntensity;

    const bounds = trackBounds(track);
    this.buildFloor(track, bounds, root);
    this.buildSurface(track, bounds, root);
    this.buildSkirts(track, root);
    this.buildBarriers(track, root);
    if (this.theme.pillars) this.buildPillars(track, root);
    this.buildWater(track, root);
    this.buildRamps(track, root);
    this.buildStartLine(track, root);
    this.buildProps(track, bounds, root);
  }

  // ------------------------------------------------------------------ floor + surface

  private buildFloor(track: Track, b: Bounds, root: TransformNode): void {
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 500;
    const floor = MeshBuilder.CreateGround("floor", { width: size, height: size }, this.scene);
    floor.position = toWorld((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, -0.02);
    const tex = floorTexture(this.scene, this.theme.floor);
    tex.uScale = size / (this.theme.floor === "tiles" ? 16 : this.theme.floor === "planks" ? 24 : 30);
    tex.vScale = tex.uScale;
    const m = mat(this.scene, "floor", "#ffffff", { specular: this.theme.floor === "tiles" ? 0.35 : 0.05 });
    m.diffuseTexture = tex;
    floor.material = m;
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
      const field = mat(this.scene, "rug-field", "#ffffff", { specular: 0.02 });
      const tex = rugTexture(this.scene);
      tex.uScale = w / RUG_TILE;
      tex.vScale = d / RUG_TILE;
      field.diffuseTexture = tex;
      rug.material = field;
      rug.receiveShadows = true;
      rug.parent = root;
      const borderMat = mat(this.scene, "rug-border", "#ffffff", { specular: 0.02 });
      borderMat.diffuseTexture = rugBorderTexture(this.scene);
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
        const t = borderMat.diffuseTexture as Texture;
        t.uScale = bw / 18;
        strip.material = borderMat;
        strip.receiveShadows = true;
        strip.parent = root;
      }
    }
    void track;
  }

  private rugMat: StandardMaterial | null = null;
  /** The rug material is disposed with its track; rebuild it for the next one. */
  private rugTrack: Track | null = null;
  private rugMaterial(): StandardMaterial {
    if (this.rugMat && this.rugMat.getScene() === this.scene && this.rugTrack === this.track) return this.rugMat;
    const m = mat(this.scene, "rug-surface", "#ffffff", { specular: 0.02 });
    m.diffuseTexture = rugTexture(this.scene);
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
    for (const [pts, side] of [[left, 0], [right, 1]] as const) {
      for (const p of pts) {
        if (style === "rug") uvs.push(new Vector2(p.x / RUG_TILE, p.y / RUG_TILE));
        else if (style === "tiles") uvs.push(new Vector2(p.x / 16, p.y / 16));
        else uvs.push(new Vector2(p.s / 8, side));
      }
    }
    const surface = MeshBuilder.CreateRibbon("surface", { pathArray: [path(left), path(right)], uvs, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    let m: StandardMaterial;
    if (style === "rug") m = this.rugMaterial();
    else if (style === "tiles") {
      m = mat(this.scene, "surface-tiles", "#ffffff", { specular: 0.35 });
      m.diffuseTexture = floorTexture(this.scene, "tiles");
    } else {
      m = mat(this.scene, `surface-${style}`, "#ffffff", { specular: 0.45, specularPower: 48 });
      m.diffuseTexture = plasticTrackTexture(this.scene, style === "plastic-orange" ? "#ff7a1a" : "#2f7de1");
    }
    surface.material = m;
    surface.receiveShadows = true;
    surface.parent = root;
  }

  /** Sides of raised sections, down to the floor (rug draped over cushions, a wooden tray…). */
  private buildSkirts(track: Track, root: TransformNode): void {
    if (this.theme.skirt === "none" || track.elevationStats().max < 0.05) return;
    const m = this.theme.skirt === "rug" ? this.rugMaterial() : mat(this.scene, "skirt-wood", "#c98b4e", { specular: 0.1 });
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
    rail.material = mat(this.scene, "rail", this.theme.railColor, { specular: 0.5, specularPower: 48 });
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
    const bases = this.theme.barrierColors.map((c, i) => {
      const box = MeshBuilder.CreateBox(`block${i}`, { width: 1.6, height: BARRIER_HEIGHT, depth: 1.6 }, this.scene);
      box.material = mat(this.scene, `block${i}`, c, { specular: 0.25 });
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
        for (let d = carry; d < len; d += 1.75) {
          const f = d / len;
          const x = a.x + (b.x - a.x) * f;
          const y = a.y + (b.y - a.y) * f;
          const z = a.z + (b.z - a.z) * f;
          const m = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), -angle), toWorld(x, y, z + BARRIER_HEIGHT / 2));
          bases[k++ % bases.length]!.thinInstanceAdd(m, false);
          carry = d + 1.75 - len;
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
    pillar.material = mat(this.scene, "pillar", "#ffd21a", { specular: 0.4 });
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
    const m = mat(this.scene, "water", this.theme.water, { alpha: 0.38, specular: 1, specularPower: 96, emissive: 0.1 });
    m.diffuseTexture = waterTexture(this.scene);
    m.backFaceCulling = false;
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
    const m = mat(this.scene, "ramp", this.theme.ramp, { specular: 0.3 });
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
    const m = mat(scene, "checker", "#ffffff", { specular: 0 });
    m.diffuseTexture = tex;
    line.material = m;
    const angle = Math.atan2(g.ty, g.tx);
    line.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -angle + Math.PI / 2);
    const mid = { x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 };
    line.position = toWorld(mid.x, mid.y, z + 0.05);
    line.parent = root;

    const pillarMat = mat(scene, "arch", "#2a3240");
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
    const bm = mat(scene, "banner", "#ffffff", { emissive: 0.4 });
    bm.diffuseTexture = bannerTex;
    banner.material = bm;
    banner.position = toWorld(mid.x, mid.y, z + 6.6);
    banner.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -angle + Math.PI / 2);
    banner.parent = root;
  }

  // ------------------------------------------------------------------ props

  /** Giant household objects around the circuit (visual only, no collision). */
  private buildProps(track: Track, b: Bounds, root: TransformNode): void {
    const scene = this.scene;
    const rng = new Rng(track.def.id.length * 977 + 7);
    const kinds = this.theme.props;
    const palette = ["#e2413b", "#f4c430", "#2f7de1", "#3dbb5c", "#c45bff", "#ff8a1a"];
    const m = (hex: string, spec = 0.3) => mat(scene, `prop-${hex}`, hex, { specular: spec });
    let placed = 0;
    for (let attempt = 0; attempt < 800 && placed < 60; attempt++) {
      const x = rng.range(b.minX - 70, b.maxX + 70);
      const y = rng.range(b.minY - 70, b.maxY + 70);
      const proj = track.project(x, y);
      if (Math.abs(proj.lateral) - track.halfWidth < 10 + rng.next() * 8) continue;
      const kind = kinds[rng.int(kinds.length)]!;
      const color = palette[rng.int(palette.length)]!;
      const node = new TransformNode(kind, scene);
      node.parent = root;
      node.position = toWorld(x, y, 0);
      node.rotation.y = rng.range(0, Math.PI * 2);
      const add = (mesh: Mesh) => {
        mesh.parent = node;
        this.shadows.addShadowCaster(mesh);
        return mesh;
      };
      switch (kind) {
        case "blocks": {
          for (let k = 0; k < 3; k++) {
            const s = rng.range(3, 6);
            const blk = add(MeshBuilder.CreateBox("toy-block", { size: s }, scene));
            blk.material = m(palette[(k + placed) % palette.length]!);
            blk.position.set(k * 1.5, s / 2 + k * s * 0.9, k);
          }
          break;
        }
        case "balls": {
          const r = rng.range(2, 4.5);
          const ball = add(MeshBuilder.CreateSphere("ball", { diameter: r * 2, segments: 24 }, scene));
          ball.material = m(color, 0.6);
          ball.position.y = r;
          break;
        }
        case "toybox": {
          const box = add(MeshBuilder.CreateBox("toybox", { width: 18, height: 10, depth: 11 }, scene));
          box.material = m("#c8331f");
          box.position.y = 5;
          const lid = add(MeshBuilder.CreateBox("lid", { width: 18.6, height: 1, depth: 11.6 }, scene));
          lid.material = m("#ffc933");
          lid.position.y = 10.4;
          break;
        }
        case "sofa": {
          const seat = add(MeshBuilder.CreateBox("sofa-seat", { width: 46, height: 9, depth: 18 }, scene));
          seat.material = m("#5b6b8c", 0.05);
          seat.position.y = 4.5;
          const back = add(MeshBuilder.CreateBox("sofa-back", { width: 46, height: 16, depth: 5 }, scene));
          back.material = seat.material;
          back.position.set(0, 12, -7);
          break;
        }
        case "cushion": {
          const c = add(MeshBuilder.CreateSphere("cushion", { diameter: 10, segments: 16 }, scene));
          c.scaling.y = 0.35;
          c.material = m(color, 0.05);
          c.position.y = 1.7;
          break;
        }
        case "book": {
          for (let k = 0; k < 3; k++) {
            const bk = add(MeshBuilder.CreateBox("book", { width: 12, height: 1.6, depth: 9 }, scene));
            bk.material = m(palette[(k * 2 + placed) % palette.length]!, 0.1);
            bk.position.set(rng.range(-1, 1), 0.8 + k * 1.6, rng.range(-1, 1));
            bk.rotation.y = rng.range(-0.3, 0.3);
          }
          break;
        }
        case "mug": {
          const cup = add(MeshBuilder.CreateCylinder("mug", { diameter: 5, height: 6, tessellation: 32 }, scene));
          cup.material = m("#f2f2f2", 0.6);
          cup.position.y = 3;
          const handle = add(MeshBuilder.CreateTorus("mug-handle", { diameter: 3, thickness: 0.6, tessellation: 24 }, scene));
          handle.rotation.x = Math.PI / 2;
          handle.material = cup.material;
          handle.position.set(3, 3, 0);
          break;
        }
        case "fridge": {
          const f = add(MeshBuilder.CreateBox("fridge", { width: 22, height: 50, depth: 20 }, scene));
          f.material = m("#e9edf2", 0.7);
          f.position.y = 25;
          break;
        }
        case "tableLeg": {
          const leg = add(MeshBuilder.CreateCylinder("table-leg", { diameter: 2.4, height: 40, tessellation: 20 }, scene));
          leg.material = m("#a0673a", 0.2);
          leg.position.y = 20;
          break;
        }
        case "fruit": {
          const r = rng.range(2.5, 4);
          const fr = add(MeshBuilder.CreateSphere("fruit", { diameter: r * 2, segments: 20 }, scene));
          fr.material = m(["#d7263d", "#7ac74f", "#ff9f1c"][rng.int(3)]!, 0.5);
          fr.position.y = r;
          break;
        }
        case "cereal": {
          const box = add(MeshBuilder.CreateBox("cereal", { width: 8, height: 14, depth: 3 }, scene));
          box.material = m(color, 0.1);
          box.position.y = 7;
          break;
        }
        case "bowl": {
          const bowl = add(MeshBuilder.CreateCylinder("bowl", { diameterTop: 9, diameterBottom: 6, height: 2.5, tessellation: 32 }, scene));
          bowl.material = m("#2f7de1", 0.5);
          bowl.position.y = 1.25;
          break;
        }
      }
      placed++;
    }
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

function floorTexture(scene: Scene, kind: ThemeStyle["floor"]): DynamicTexture {
  if (kind === "tiles") {
    return canvasTexture(scene, "tiles", 512, (c, s) => {
      c.fillStyle = "#b9c2c9";
      c.fillRect(0, 0, s, s);
      const n = 2;
      const t = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? "#f4f6f8" : "#dfe9ee";
        c.fillRect(i * t + 4, j * t + 4, t - 8, t - 8);
        c.fillStyle = "rgba(255,255,255,0.35)";
        c.fillRect(i * t + 10, j * t + 10, t * 0.35, 6);
      }
    });
  }
  if (kind === "carpet") {
    return canvasTexture(scene, "carpet", 256, (c, s) => {
      c.fillStyle = "#5d6f8f";
      c.fillRect(0, 0, s, s);
      for (let k = 0; k < 2500; k++) {
        c.fillStyle = `rgba(${200 + (k % 50)},${210 + (k % 40)},255,${0.05 + (k % 7) * 0.01})`;
        c.fillRect((k * 97) % s, (k * 57) % s, 2, 2);
      }
    });
  }
  return canvasTexture(scene, "planks", 512, (c) => {
    for (let i = 0; i < 8; i++) {
      const shade = 120 + ((i * 37) % 30);
      c.fillStyle = `rgb(${shade + 50}, ${shade + 5}, ${shade - 45})`;
      c.fillRect(0, i * 64, 512, 62);
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.fillRect(((i * 173) % 400) + 40, i * 64, 3, 62);
    }
  });
}

/** Persian-style rug field: one tileable medallion repeat (fine detail, repeats every RUG_TILE m). */
function rugTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, "rug", 512, (c, s) => {
    c.fillStyle = "#7d1f24";
    c.fillRect(0, 0, s, s);
    const h = s / 2;
    for (const [ox, oy] of [[0, 0], [h, h]] as const) {
      for (const [dx, dy] of [[0, 0], [s, 0], [0, s], [s, s]] as const) {
        const x = ox + dx;
        const y = oy + dy;
        c.fillStyle = "#b8862f";
        c.beginPath();
        c.moveTo(x, y - h * 0.8);
        c.lineTo(x + h * 0.8, y);
        c.lineTo(x, y + h * 0.8);
        c.lineTo(x - h * 0.8, y);
        c.closePath();
        c.fill();
        c.fillStyle = "#1e2b4f";
        c.beginPath();
        c.moveTo(x, y - h * 0.55);
        c.lineTo(x + h * 0.55, y);
        c.lineTo(x, y + h * 0.55);
        c.lineTo(x - h * 0.55, y);
        c.closePath();
        c.fill();
        c.fillStyle = "#e8d6b0";
        c.beginPath();
        c.arc(x, y, h * 0.18, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Woven speckle so it reads as fabric up close.
    for (let k = 0; k < 3000; k++) {
      c.fillStyle = `rgba(0,0,0,${0.04 + (k % 5) * 0.012})`;
      c.fillRect((k * 131) % s, (k * 71) % s, 2, 2);
    }
  });
}

/** Woven border band for the rug edges (repeats along its length). */
function rugBorderTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, "rug-border", 256, (c, s) => {
    c.fillStyle = "#1e2b4f";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "#d9a441";
    c.fillRect(0, s * 0.18, s, s * 0.1);
    c.fillRect(0, s * 0.72, s, s * 0.1);
    c.fillStyle = "#7d1f24";
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

function waterTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, "water", 256, (c, s) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, s, s);
    for (let k = 0; k < 60; k++) {
      c.strokeStyle = `rgba(160,220,255,${0.3 + (k % 5) * 0.08})`;
      c.lineWidth = 2;
      c.beginPath();
      const y = (k * 37) % s;
      c.moveTo(0, y);
      c.bezierCurveTo(s * 0.3, y - 8, s * 0.6, y + 8, s, y);
      c.stroke();
    }
  });
}
