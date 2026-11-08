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
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { Rng, type Track } from "@rc/game-core";

/** Game (x, y) on the floor plane → Babylon (x, height, y). */
export const toWorld = (x: number, y: number, h = 0) => new Vector3(x, h, y);

export function mat(scene: Scene, name: string, hex: string, opts: { emissive?: number; specular?: number; alpha?: number } = {}): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = new Color3(opts.specular ?? 0.15, opts.specular ?? 0.15, opts.specular ?? 0.15);
  if (opts.emissive) m.emissiveColor = c.scale(opts.emissive);
  if (opts.alpha !== undefined) m.alpha = opts.alpha;
  return m;
}

/** Engine, scene, lights, chase camera and the static workshop track. */
export class World {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly shadows: ShadowGenerator;
  private camPos = new Vector3(0, 30, -30);
  private camTarget = new Vector3(0, 0, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }, true);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.06, 0.08, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0022;
    this.scene.fogColor = new Color3(0.07, 0.08, 0.1);
    this.scene.skipPointerMovePicking = true;
    this.camera = new UniversalCamera("chase", this.camPos.clone(), this.scene);
    this.camera.fov = 1.0;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 1200;
    this.camera.inputs.clear();
    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.18, 0.15, 0.12);
    const sun = new DirectionalLight("lamp", new Vector3(-0.4, -1, 0.3), this.scene);
    sun.position = new Vector3(200, 220, -120);
    sun.intensity = 0.9;
    this.shadows = new ShadowGenerator(1024, sun);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 16;
    this.shadows.darkness = 0.35;
    window.addEventListener("resize", () => this.engine.resize());
  }

  /** Smooth chase camera behind a pose. */
  follow(x: number, y: number, heading: number, speed: number, dtSeconds: number, snap = false): void {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const back = 10 + Math.min(speed, 40) * 0.1;
    const desired = toWorld(x - fx * back, y - fy * back, 5.4 + speed * 0.03);
    const target = toWorld(x + fx * 9, y + fy * 9, 0.2);
    const k = snap ? 1 : 1 - Math.exp(-dtSeconds * 6);
    this.camPos = Vector3.Lerp(this.camPos, desired, k);
    this.camTarget = Vector3.Lerp(this.camTarget, target, snap ? 1 : 1 - Math.exp(-dtSeconds * 10));
    this.camera.position.copyFrom(this.camPos);
    this.camera.setTarget(this.camTarget);
  }

  /** Overview camera for lobby/results. */
  orbit(track: Track, t: number): void {
    const cx = track.xs.reduce((a, b) => a + b, 0) / track.count;
    const cy = track.ys.reduce((a, b) => a + b, 0) / track.count;
    this.camera.position.copyFrom(toWorld(cx + Math.cos(t * 0.05) * 260, cy + Math.sin(t * 0.05) * 260, 140));
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

  buildTrack(track: Track): void {
    const scene = this.scene;
    // Workshop floor: warm wooden planks.
    const floorTex = new DynamicTexture("planks", { width: 512, height: 512 }, scene, true);
    const ctx = floorTex.getContext() as CanvasRenderingContext2D;
    for (let i = 0; i < 8; i++) {
      const shade = 120 + ((i * 37) % 30);
      ctx.fillStyle = `rgb(${shade + 40}, ${shade}, ${shade - 50})`;
      ctx.fillRect(0, i * 64, 512, 62);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(((i * 173) % 400) + 40, i * 64, 3, 62);
    }
    floorTex.update();
    floorTex.uScale = 60;
    floorTex.vScale = 60;
    const floorMat = mat(scene, "floor", "#ffffff", { specular: 0.05 });
    floorMat.diffuseTexture = floorTex;
    const floor = MeshBuilder.CreateGround("floor", { width: 1400, height: 1400 }, scene);
    floor.position = toWorld(100, 100, -0.02);
    floor.material = floorMat;
    floor.receiveShadows = true;

    // Racing surface: dark rubber mat between the boundaries.
    const left = track.boundary(1).map((p) => toWorld(p.x, p.y, 0.01));
    const right = track.boundary(-1).map((p) => toWorld(p.x, p.y, 0.01));
    const road = MeshBuilder.CreateRibbon("road", { pathArray: [left, right], closePath: false, sideOrientation: Mesh.DOUBLESIDE }, scene);
    road.material = mat(scene, "mat-road", "#262a31", { specular: 0.05 });
    road.receiveShadows = true;

    // White edge tape, inset slightly from the walls.
    for (const side of [1, -1] as const) {
      const outer = track.boundary(side, 0.4).map((p) => toWorld(p.x, p.y, 0.02));
      const inner = track.boundary(side, 0.9).map((p) => toWorld(p.x, p.y, 0.02));
      const tape = MeshBuilder.CreateRibbon(`edge${side}`, { pathArray: [outer, inner], sideOrientation: Mesh.DOUBLESIDE }, scene);
      tape.material = mat(scene, `tape${side}`, "#e9e4d8", { specular: 0 });
    }

    this.buildWalls(track);
    this.buildStartLine(track);
    this.buildProps(track);
  }

  private buildWalls(track: Track): void {
    const scene = this.scene;
    const yellow = MeshBuilder.CreateBox("wall-y", { width: 1, height: 1, depth: 1 }, scene);
    yellow.material = mat(scene, "wall-yellow", "#ffc933", { specular: 0.2 });
    const dark = MeshBuilder.CreateBox("wall-d", { width: 1, height: 1, depth: 1 }, scene);
    dark.material = mat(scene, "wall-dark", "#1d232d", { specular: 0.2 });
    const height = 1.4;
    for (const side of [1, -1] as const) {
      const pts = track.boundary(side, -0.35);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const base = Math.floor(i / 2) % 2 === 0 ? yellow : dark;
        const m = Matrix.Compose(
          new Vector3(len + 0.05, height, 0.7),
          Quaternion.RotationAxis(Vector3.Up(), -angle),
          toWorld((a.x + b.x) / 2, (a.y + b.y) / 2, height / 2),
        );
        base.thinInstanceAdd(m, false);
      }
    }
    yellow.thinInstanceRefreshBoundingInfo();
    dark.thinInstanceRefreshBoundingInfo();
    yellow.freezeWorldMatrix();
    dark.freezeWorldMatrix();
  }

  private buildStartLine(track: Track): void {
    const scene = this.scene;
    const g = track.gates[0]!;
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
    line.position = toWorld(mid.x, mid.y, 0.03);

    // Arch with a banner over the line.
    const pillarMat = mat(scene, "pillar", "#2a3240");
    for (const end of [{ x: g.ax, y: g.ay }, { x: g.bx, y: g.by }]) {
      const p = MeshBuilder.CreateBox("pillar", { width: 0.8, height: 7, depth: 0.8 }, scene);
      p.position = toWorld(end.x, end.y, 3.5);
      p.material = pillarMat;
      this.shadows.addShadowCaster(p);
    }
    const bannerTex = new DynamicTexture("banner", { width: 1024, height: 128 }, scene, true);
    const bc = bannerTex.getContext() as CanvasRenderingContext2D;
    bc.fillStyle = "#ffc933";
    bc.fillRect(0, 0, 1024, 128);
    bc.fillStyle = "#1b1500";
    bc.font = "bold 84px 'Chakra Petch', Arial, sans-serif";
    bc.textAlign = "center";
    bc.textBaseline = "middle";
    bc.fillText("GARAGE RUMBLE", 512, 68);
    bannerTex.update();
    const banner = MeshBuilder.CreatePlane("banner", { width: Math.hypot(g.bx - g.ax, g.by - g.ay), height: 1.6, sideOrientation: Mesh.DOUBLESIDE }, scene);
    const bm = mat(scene, "banner", "#ffffff", { emissive: 0.4 });
    bm.diffuseTexture = bannerTex;
    banner.material = bm;
    banner.position = toWorld(mid.x, mid.y, 6.6);
    banner.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -angle + Math.PI / 2);
  }

  /** Oversized workshop clutter around the circuit (purely decorative, no collision). */
  private buildProps(track: Track): void {
    const scene = this.scene;
    const rng = new Rng(7);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.xs[i]!); maxX = Math.max(maxX, track.xs[i]!);
      minY = Math.min(minY, track.ys[i]!); maxY = Math.max(maxY, track.ys[i]!);
    }
    const mats = {
      toolbox: mat(scene, "toolbox", "#c8331f", { specular: 0.4 }),
      can: mat(scene, "can", "#2f9bff", { specular: 0.5 }),
      carton: mat(scene, "carton", "#b88a52", { specular: 0.05 }),
      steel: mat(scene, "steel", "#9aa3b0", { specular: 0.8 }),
      handle: mat(scene, "handle", "#ffc933", { specular: 0.3 }),
    };
    let placed = 0;
    for (let attempt = 0; attempt < 600 && placed < 70; attempt++) {
      const x = rng.range(minX - 60, maxX + 60);
      const y = rng.range(minY - 60, maxY + 60);
      const proj = track.project(x, y);
      const clearance = Math.abs(proj.lateral) - track.halfWidth;
      if (clearance < 8 + rng.next() * 6) continue;
      const kind = rng.int(4);
      const yaw = rng.range(0, Math.PI * 2);
      let mesh: Mesh;
      if (kind === 0) {
        const s = rng.range(5, 9);
        mesh = MeshBuilder.CreateBox("toolbox", { width: s * 1.8, height: s, depth: s }, scene);
        mesh.material = mats.toolbox;
        mesh.position = toWorld(x, y, s / 2);
        const handle = MeshBuilder.CreateBox("handle", { width: s * 1.2, height: 0.5, depth: 0.8 }, scene);
        handle.material = mats.handle;
        handle.parent = mesh;
        handle.position.y = s / 2 + 0.5;
      } else if (kind === 1) {
        const r = rng.range(2, 4);
        mesh = MeshBuilder.CreateCylinder("can", { diameter: r * 2, height: r * 2.4, tessellation: 20 }, scene);
        mesh.material = mats.can;
        mesh.position = toWorld(x, y, r * 1.2);
      } else if (kind === 2) {
        const s = rng.range(4, 8);
        mesh = MeshBuilder.CreateBox("carton", { width: s, height: s * 0.8, depth: s * 1.2 }, scene);
        mesh.material = mats.carton;
        mesh.position = toWorld(x, y, s * 0.4);
      } else {
        mesh = MeshBuilder.CreateCylinder("bolt", { diameter: 1.4, height: 14, tessellation: 6 }, scene);
        mesh.material = mats.steel;
        mesh.rotation.z = Math.PI / 2;
        mesh.position = toWorld(x, y, 0.7);
      }
      mesh.rotation.y = yaw;
      mesh.freezeWorldMatrix();
      this.shadows.addShadowCaster(mesh);
      placed++;
    }
  }

  dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}
