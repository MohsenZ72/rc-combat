import { Matrix, MeshBuilder, Quaternion, Vector3, type Mesh, type TransformNode } from "@babylonjs/core";
import { Rng, type Track, type TrackTheme } from "@rc/game-core";
import * as F from "./furniture.js";
import { CM } from "./furniture.js";
import type { Kit } from "./kit.js";

/** Room rectangle in game metres, plus helpers to stand furniture against its walls. */
export interface Room {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Wall height (0 for outdoor scenes). */
  height: number;
}

type Side = "north" | "south" | "east" | "west";

const ROOM_MARGIN = 130;
const WALL_HEIGHT = 260 * CM;

export function roomFor(bounds: { minX: number; minY: number; maxX: number; maxY: number }, outdoor: boolean): Room {
  return {
    x0: bounds.minX - ROOM_MARGIN,
    y0: bounds.minY - ROOM_MARGIN,
    x1: bounds.maxX + ROOM_MARGIN,
    y1: bounds.maxY + ROOM_MARGIN,
    height: outdoor ? 0 : WALL_HEIGHT,
  };
}

/** Point on a wall at fraction t along it, with the inward normal (furniture faces it). */
function wallPoint(r: Room, side: Side, t: number): { x: number; y: number; nx: number; ny: number; len: number } {
  switch (side) {
    case "north":
      return { x: r.x0 + (r.x1 - r.x0) * t, y: r.y1, nx: 0, ny: -1, len: r.x1 - r.x0 };
    case "south":
      return { x: r.x1 - (r.x1 - r.x0) * t, y: r.y0, nx: 0, ny: 1, len: r.x1 - r.x0 };
    case "east":
      return { x: r.x1, y: r.y0 + (r.y1 - r.y0) * t, nx: -1, ny: 0, len: r.y1 - r.y0 };
    case "west":
      return { x: r.x0, y: r.y1 - (r.y1 - r.y0) * t, nx: 1, ny: 0, len: r.y1 - r.y0 };
  }
}

/** Distance from the track's edge (negative = on the track). */
function trackClearance(track: Track, x: number, y: number): number {
  return Math.abs(track.project(x, y).lateral) - track.halfWidth;
}

/** Best free floor spot for a big centre piece (table, bed, pool…), or null if nothing fits. */
function freeSpot(track: Track, r: Room, radius: number, taken: { x: number; y: number; r: number }[]): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  const step = 14;
  for (let x = r.x0 + radius; x <= r.x1 - radius; x += step) {
    for (let y = r.y0 + radius; y <= r.y1 - radius; y += step) {
      const clear = trackClearance(track, x, y) - radius;
      if (clear < 6) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + radius + 6)) continue;
      const score = clear;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (best) taken.push({ x: best.x, y: best.y, r: radius });
  return best;
}

type Builder = (k: Kit, g: TransformNode) => void;

class Layout {
  readonly taken: { x: number; y: number; r: number }[] = [];
  constructor(readonly k: Kit, readonly track: Track, readonly r: Room) {}

  /** Stand a piece against a wall; `fromWallCm` pushes it out (e.g. wall-hung items use 0). */
  wall(side: Side, t: number, build: Builder, fromWallCm = 0, heightCm = 0): void {
    const p = wallPoint(this.r, side, t);
    const g = this.k.facing("wall-item", p.x + p.nx * fromWallCm * CM, p.y + p.ny * fromWallCm * CM, p.nx, p.ny, heightCm * CM);
    build(this.k, g);
    const merged = this.k.finish(g);
    // Never let furniture intrude on the racing line: drop any piece whose footprint touches the track.
    if (merged && this.blocksTrack(merged)) g.dispose(false, true);
  }

  private blocksTrack(mesh: Mesh): boolean {
    mesh.refreshBoundingInfo();
    const bb = mesh.getBoundingInfo().boundingBox;
    const min = bb.minimumWorld;
    const max = bb.maximumWorld;
    if (min.y > 12) return false; // wall-hung above the cars
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const x = min.x + ((max.x - min.x) * i) / 4;
        const y = min.z + ((max.z - min.z) * j) / 4;
        if (trackClearance(this.track, x, y) < 4) return true;
      }
    }
    return false;
  }

  /** A centre piece in the largest free area (skipped if the track leaves no room). */
  centre(radius: number, build: Builder, yaw = 0): void {
    const spot = freeSpot(this.track, this.r, radius, this.taken);
    if (!spot) return;
    const g = this.k.group("centre-item", spot.x, spot.y, yaw);
    build(this.k, g);
    this.k.finish(g);
  }
}

// ------------------------------------------------------------------ shell (walls, ceiling, light)

export interface RoomStyle {
  wall: string;
  wallLower?: string;
  baseboard: string;
  ceiling: string;
}

const ROOM_STYLES: Partial<Record<TrackTheme, RoomStyle>> = {
  "toy-track": { wall: "#f3d9b1", wallLower: "#9fc5e8", baseboard: "#ffffff", ceiling: "#f7f3ea" },
  rug: { wall: "#e9dcc8", baseboard: "#f7f3ea", ceiling: "#f7f3ea" },
  kitchen: { wall: "#f1efe9", wallLower: "#cfe6e1", baseboard: "#d8d3c8", ceiling: "#ffffff" },
  "toy-canyon": { wall: "#c7dcf2", wallLower: "#f6e7a6", baseboard: "#ffffff", ceiling: "#ffffff" },
  bathroom: { wall: "#d9eef2", wallLower: "#9fd0d8", baseboard: "#ffffff", ceiling: "#ffffff" },
  bedroom: { wall: "#f2d5dd", baseboard: "#ffffff", ceiling: "#ffffff" },
  workshop: { wall: "#a8acb1", wallLower: "#7e858c", baseboard: "#4b5157", ceiling: "#8a9097" },
  library: { wall: "#5e3b2b", wallLower: "#3d2a1f", baseboard: "#2a1d15", ceiling: "#e9dcc8" },
};

function buildShell(k: Kit, r: Room, style: RoomStyle): void {
  const g = k.group("room-shell", 0, 0);
  const w = r.x1 - r.x0;
  const d = r.y1 - r.y0;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const H = r.height;
  // A little self-light so walls read as lit by the room, not as dark slabs.
  const wall = k.mat(style.wall, { spec: 0.05, emissive: 0.22 });
  const lower = k.mat(style.wallLower ?? style.wall, { spec: 0.08, emissive: 0.18 });
  const base = k.mat(style.baseboard, { spec: 0.3 });
  const lowerH = 90 * CM;
  for (const [x, y, len, rotY] of [
    [cx, r.y1, w, 0],
    [cx, r.y0, w, Math.PI],
    [r.x1, cy, d, Math.PI / 2],
    [r.x0, cy, d, -Math.PI / 2],
  ] as const) {
    k.box(g, [len, H - lowerH, 2], [x, lowerH + (H - lowerH) / 2, y], wall, [0, rotY, 0]);
    k.box(g, [len, lowerH, 2.4], [x, lowerH / 2, y], lower, [0, rotY, 0]);
    k.box(g, [len, 10 * CM, 4], [x, 5 * CM, y], base, [0, rotY, 0]);
    k.box(g, [len, 4 * CM, 3], [x, lowerH, y], base, [0, rotY, 0]);
  }
  k.box(g, [w, 2, d], [cx, H, cy], k.mat(style.ceiling, { spec: 0.02, emissive: 0.55 }));
  // Ceiling lights.
  for (const fx of [0.3, 0.7]) for (const fy of [0.35, 0.65]) {
    const x = r.x0 + w * fx;
    const y = r.y0 + d * fy;
    k.cyl(g, 50 * CM, 4 * CM, [x, H - 2 * CM, y], k.mat("#fff6dc", { emissive: 1 }));
  }
  k.finish(g, false);
}

// ------------------------------------------------------------------ scatter (thin instances)

/** Lots of tiny props sprinkled on the floor near the track: crumbs, pebbles, Lego, leaves… */
function scatter(k: Kit, track: Track, r: Room, items: { mesh: () => Mesh; count: number; near?: boolean; tilt?: boolean }[], seed: number): void {
  const rng = new Rng(seed);
  for (const item of items) {
    const base = item.mesh();
    base.parent = k.root;
    let placed = 0;
    for (let attempt = 0; attempt < item.count * 6 && placed < item.count; attempt++) {
      let x: number;
      let y: number;
      if (item.near) {
        const s = rng.range(0, track.length);
        const pose = track.poseAt(s);
        const side = rng.next() < 0.5 ? 1 : -1;
        const off = track.halfWidth + rng.range(3.5, 22);
        x = pose.x - Math.sin(pose.heading) * off * side;
        y = pose.y + Math.cos(pose.heading) * off * side;
      } else {
        x = rng.range(r.x0 + 4, r.x1 - 4);
        y = rng.range(r.y0 + 4, r.y1 - 4);
      }
      if (trackClearance(track, x, y) < 3) continue;
      const s = rng.range(0.7, 1.4);
      const q = item.tilt ? Quaternion.RotationYawPitchRoll(rng.range(0, 6.28), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)) : Quaternion.RotationAxis(Vector3.Up(), rng.range(0, 6.28));
      base.thinInstanceAdd(Matrix.Compose(new Vector3(s, s, s), q, new Vector3(x, 0, y)), false);
      placed++;
    }
    base.thinInstanceRefreshBoundingInfo();
  }
}

function mk(k: Kit, factory: () => Mesh, hex: string, spec = 0.2, y = 0): () => Mesh {
  return () => {
    const m = factory();
    m.material = k.mat(hex, { spec });
    m.bakeTransformIntoVertices(Matrix.Translation(0, y, 0));
    return m;
  };
}

// ------------------------------------------------------------------ per-theme rooms

/** Builds the whole environment for a track's theme: shell, furniture, centre pieces, scatter. */
export function buildRoom(k: Kit, track: Track, r: Room): void {
  const theme = track.def.theme;
  const style = ROOM_STYLES[theme];
  if (style && r.height > 0) buildShell(k, r, style);
  const L = new Layout(k, track, r);
  const sc = k.scene;
  switch (theme) {
    case "kitchen": {
      // North wall: the sink run under the window, dishwasher, kettle, toaster, upper cabinets.
      L.wall("north", 0.3, (k, g) => {
        F.counterRun(k, g, 300, { sink: true, dishwasherAt: 1 });
        F.kettle(k, g, 85 * CM, 92 * CM, 25 * CM);
        F.toaster(k, g, 120 * CM, 92 * CM, 25 * CM);
        F.fruitBowl(k, g, -110 * CM, 92 * CM, 30 * CM);
      });
      L.wall("north", 0.3, (k, g) => F.windowFrame(k, g, 140, 110, 110));
      L.wall("north", 0.58, (k, g) => {
        F.counterRun(k, g, 120);
        F.microwave(k, g, 92 * CM);
        F.upperCabinets(k, g, 120);
      });
      L.wall("north", 0.74, (k, g) => F.stove(k, g));
      L.wall("north", 0.74, (k, g) => F.rangeHood(k, g));
      L.wall("north", 0.86, (k, g) => F.fridge(k, g));
      // East wall: laundry corner.
      L.wall("east", 0.2, (k, g) => F.washingMachine(k, g));
      L.wall("east", 0.33, (k, g) => F.washingMachine(k, g, true));
      L.wall("east", 0.33, (k, g) => F.washingMachine(k, g, true), 0, 86);
      L.wall("east", 0.48, (k, g) => F.laundryBasket(k, g));
      L.wall("east", 0.7, (k, g) => F.door(k, g));
      L.wall("east", 0.88, (k, g) => F.radiator(k, g));
      // South & west: dresser, plant, bin, pet bowls, pictures.
      L.wall("south", 0.15, (k, g) => F.trashBin(k, g));
      L.wall("south", 0.35, (k, g) => F.plant(k, g, 0, 25 * CM, 1.4));
      L.wall("south", 0.55, (k, g) => F.bookshelf(k, g, 100, 180, "#e8e2d6"));
      L.wall("south", 0.75, (k, g) => F.picture(k, g, 60, 45, 160, "#7fb3d5"));
      L.wall("west", 0.3, (k, g) => F.windowFrame(k, g, 120, 120, 90));
      L.wall("west", 0.6, (k, g) => F.petBowl(k, g, 0, 20 * CM));
      L.wall("west", 0.8, (k, g) => F.clock(k, g, 190));
      L.centre(70, (k, g) => {
        F.table(k, g);
        for (const [x, z, a] of [[0, -55, 0], [0, 55, Math.PI], [-75, 0, Math.PI / 2], [75, 0, -Math.PI / 2]] as const) {
          const ch = k.group("chair", 0, 0);
          ch.parent = g;
          ch.position.set(x * CM, 0, z * CM);
          ch.rotation.y = a;
          F.chair(k, ch);
        }
        F.fruitBowl(k, g, 0, 77 * CM, 0);
      });
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("crumb", { size: 0.35 }, sc), "#d9a441", 0.1, 0.17), count: 260, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("pea", { diameter: 0.9, height: 0.9, tessellation: 8 }, sc), "#7ac74f", 0.3, 0.45), count: 60 },
        { mesh: mk(k, () => MeshBuilder.CreateBox("spoon", { width: 6, height: 0.25, depth: 1.2 }, sc), "#c8cdd3", 1, 0.12), count: 14, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("cap", { diameter: 1.6, height: 0.4, tessellation: 16 }, sc), "#e2413b", 0.5, 0.2), count: 30, near: true },
      ], 11);
      break;
    }
    case "rug": {
      L.wall("north", 0.35, (k, g) => F.sofa(k, g));
      L.wall("north", 0.12, (k, g) => F.floorLamp(k, g));
      L.wall("north", 0.6, (k, g) => F.armchair(k, g));
      L.wall("north", 0.8, (k, g) => F.plant(k, g, 0, 25 * CM, 1.5));
      L.wall("south", 0.4, (k, g) => F.tvStand(k, g));
      L.wall("south", 0.7, (k, g) => F.bookshelf(k, g));
      L.wall("south", 0.88, (k, g) => F.bookshelf(k, g));
      L.wall("east", 0.3, (k, g) => F.windowFrame(k, g, 160, 140, 70));
      L.wall("east", 0.7, (k, g) => F.windowFrame(k, g, 160, 140, 70));
      L.wall("east", 0.5, (k, g) => F.radiator(k, g));
      L.wall("west", 0.25, (k, g) => F.door(k, g));
      L.wall("west", 0.6, (k, g) => F.picture(k, g, 90, 60, 160, "#c97b5a"));
      L.wall("west", 0.8, (k, g) => F.picture(k, g, 50, 70, 150, "#5a7bc9"));
      L.wall("south", 0.18, (k, g) => F.toyBox(k, g));
      L.centre(45, (k, g) => F.coffeeTable(k, g));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#e2413b", 0.4, 0.6), count: 70, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego2", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#2f7de1", 0.4, 0.6), count: 70, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("coin", { diameter: 2, height: 0.3, tessellation: 20 }, sc), "#d4a72c", 1, 0.15), count: 40 },
        { mesh: mk(k, () => MeshBuilder.CreateBox("popcorn", { size: 0.9 }, sc), "#fff3c4", 0.05, 0.45), count: 120, near: true, tilt: true },
      ], 12);
      break;
    }
    case "toy-track": {
      L.wall("north", 0.2, (k, g) => F.toyBox(k, g));
      L.wall("north", 0.4, (k, g) => F.bookshelf(k, g, 120, 150, "#f2ead8"));
      L.wall("north", 0.62, (k, g) => F.windowFrame(k, g, 150, 120, 90));
      L.wall("north", 0.82, (k, g) => F.teddy(k, g));
      L.wall("east", 0.3, (k, g) => F.toyBlocksTower(k, g, 8));
      L.wall("east", 0.6, (k, g) => F.poster(k, g, 160, "#2f7de1", "#ffc933"));
      L.wall("east", 0.8, (k, g) => F.door(k, g));
      L.wall("south", 0.3, (k, g) => F.bed(k, g, "#3ddc84"));
      L.wall("south", 0.7, (k, g) => F.desk(k, g));
      L.wall("west", 0.3, (k, g) => F.poster(k, g, 160, "#e2413b", "#f2f2f2"));
      L.wall("west", 0.6, (k, g) => F.toyBlocksTower(k, g, 5));
      L.wall("west", 0.8, (k, g) => F.teddy(k, g));
      L.centre(30, (k, g) => F.toyBox(k, g));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#ffc933", 0.4, 0.6), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego2", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#3ddc84", 0.4, 0.6), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("crayon", { diameter: 0.8, height: 6, tessellation: 6 }, sc), "#c45bff", 0.3, 0), count: 40, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("marble", { diameter: 1.4, segments: 8 }, sc), "#26d7d7", 1, 0.7), count: 50 },
      ], 13);
      break;
    }
    case "toy-canyon": {
      L.wall("north", 0.3, (k, g) => F.bed(k, g, "#2f7de1"));
      L.wall("north", 0.65, (k, g) => F.wardrobe(k, g));
      L.wall("north", 0.85, (k, g) => F.nightstand(k, g));
      L.wall("east", 0.4, (k, g) => F.desk(k, g));
      L.wall("east", 0.7, (k, g) => F.windowFrame(k, g, 150, 130, 80));
      L.wall("south", 0.2, (k, g) => F.toyBox(k, g));
      L.wall("south", 0.45, (k, g) => F.poster(k, g, 160, "#c45bff", "#ffc933"));
      L.wall("south", 0.7, (k, g) => F.bookshelf(k, g, 90, 160, "#f2ead8"));
      L.wall("west", 0.3, (k, g) => F.door(k, g));
      L.wall("west", 0.65, (k, g) => F.teddy(k, g));
      for (let i = 0; i < 4; i++) L.centre(22, (k, g) => F.toyBox(k, g), i);
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#e2413b", 0.4, 0.6), count: 120, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("marble", { diameter: 1.4, segments: 8 }, sc), "#ffc933", 1, 0.7), count: 50 },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("sock", { diameter: 3, height: 8, tessellation: 8 }, sc), "#f2f2f2", 0.02, 0), count: 6, tilt: true },
      ], 14);
      break;
    }
    case "bathroom": {
      L.wall("north", 0.35, (k, g) => F.bathtub(k, g));
      L.wall("north", 0.7, (k, g) => F.towelRail(k, g));
      L.wall("north", 0.88, (k, g) => F.radiator(k, g));
      L.wall("east", 0.3, (k, g) => F.toilet(k, g));
      L.wall("east", 0.6, (k, g) => F.vanity(k, g));
      L.wall("east", 0.85, (k, g) => F.laundryBasket(k, g));
      L.wall("south", 0.3, (k, g) => F.windowFrame(k, g, 100, 80, 130, "#dff1ff"));
      L.wall("south", 0.6, (k, g) => F.washingMachine(k, g));
      L.wall("south", 0.8, (k, g) => F.plant(k, g, 0, 25 * CM, 1.1));
      L.wall("west", 0.4, (k, g) => F.door(k, g));
      L.wall("west", 0.75, (k, g) => F.towelRail(k, g));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateSphere("duck", { diameter: 3, segments: 10 }, sc), "#ffd21a", 0.6, 1.2), count: 18, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("soap", { width: 3, height: 1, depth: 2 }, sc), "#ff9fbf", 0.5, 0.5), count: 14, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("bud", { diameter: 0.25, height: 3, tessellation: 6 }, sc), "#f2f2f2", 0.1, 0), count: 50, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("bubble", { diameter: 1.5, segments: 8 }, sc), "#e8f6ff", 1, 0.75), count: 90 },
      ], 15);
      break;
    }
    case "bedroom": {
      L.wall("north", 0.35, (k, g) => F.bed(k, g, "#ff6fb5"));
      L.wall("north", 0.12, (k, g) => F.nightstand(k, g));
      L.wall("north", 0.62, (k, g) => F.nightstand(k, g));
      L.wall("north", 0.82, (k, g) => F.wardrobe(k, g));
      L.wall("east", 0.3, (k, g) => F.desk(k, g));
      L.wall("east", 0.6, (k, g) => F.windowFrame(k, g, 160, 130, 80));
      L.wall("east", 0.85, (k, g) => F.bookshelf(k, g, 80, 180, "#f2ead8"));
      L.wall("south", 0.25, (k, g) => F.toyBox(k, g));
      L.wall("south", 0.5, (k, g) => F.poster(k, g, 160, "#3ddc84", "#2f7de1"));
      L.wall("south", 0.75, (k, g) => F.teddy(k, g));
      L.wall("west", 0.3, (k, g) => F.door(k, g));
      L.wall("west", 0.6, (k, g) => F.floorLamp(k, g));
      L.wall("west", 0.8, (k, g) => F.picture(k, g, 60, 80, 150, "#f2c9d5"));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("pencil", { diameter: 0.7, height: 7, tessellation: 6 }, sc), "#ffc933", 0.3, 0), count: 40, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#c45bff", 0.4, 0.6), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("paper", { width: 8, height: 0.1, depth: 11 }, sc), "#ffffff", 0.05, 0.05), count: 12 },
      ], 16);
      break;
    }
    case "workshop": {
      L.wall("north", 0.3, (k, g) => F.workbench(k, g));
      L.wall("north", 0.6, (k, g) => F.toolChest(k, g));
      L.wall("north", 0.8, (k, g) => F.shelves(k, g));
      L.wall("east", 0.5, (k, g) => F.garageDoor(k, g, 260));
      L.wall("east", 0.15, (k, g) => F.tyreStack(k, g));
      L.wall("east", 0.85, (k, g) => F.oilDrum(k, g));
      L.wall("south", 0.25, (k, g) => F.shelves(k, g));
      L.wall("south", 0.5, (k, g) => F.ladder(k, g));
      L.wall("south", 0.75, (k, g) => F.tyreStack(k, g));
      L.wall("west", 0.3, (k, g) => F.door(k, g));
      L.wall("west", 0.6, (k, g) => F.oilDrum(k, g));
      L.wall("west", 0.8, (k, g) => F.windowFrame(k, g, 120, 70, 140, "#cfe6ff"));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("nut", { diameter: 1.4, height: 0.7, tessellation: 6 }, sc), "#9aa3b0", 0.9, 0.35), count: 140, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("screw", { diameter: 0.4, height: 3, tessellation: 6 }, sc), "#c8cdd3", 0.9, 0), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("shaving", { width: 2.5, height: 0.2, depth: 0.8 }, sc), "#d9b878", 0.05, 0.1), count: 200, tilt: true },
      ], 17);
      break;
    }
    case "library": {
      for (const side of ["north", "south"] as const) for (const t of [0.12, 0.27, 0.42, 0.58, 0.73, 0.88]) L.wall(side, t, (k, g) => F.bookshelf(k, g, 100, 230));
      L.wall("east", 0.25, (k, g) => F.windowFrame(k, g, 120, 180, 60, "#ffe9b8"));
      L.wall("east", 0.55, (k, g) => F.readingChair(k, g));
      L.wall("east", 0.75, (k, g) => F.floorLamp(k, g));
      L.wall("west", 0.3, (k, g) => F.desk(k, g));
      L.wall("west", 0.55, (k, g) => F.globe(k, g));
      L.wall("west", 0.75, (k, g) => F.clock(k, g, 200));
      L.wall("west", 0.88, (k, g) => F.plant(k, g, 0, 25 * CM, 1.3));
      for (let i = 0; i < 3; i++) L.centre(14, (k, g) => F.bookStack(k, g, 6 + i * 2), i);
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("paper", { width: 8, height: 0.1, depth: 11 }, sc), "#f6f0e0", 0.05, 0.05), count: 40, tilt: false },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("pencil", { diameter: 0.7, height: 7, tessellation: 6 }, sc), "#2f7a3d", 0.3, 0), count: 30, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("bookmark", { width: 1.2, height: 0.1, depth: 6 }, sc), "#d7263d", 0.1, 0.05), count: 20, near: true },
      ], 18);
      break;
    }
    case "garden": {
      // A house wall on one side, fences round the rest, a big tree, beds, gnome, birdbath.
      L.wall("north", 0.5, (k, g) => {
        k.box(g, [r.x1 - r.x0, 300 * CM, 6], [0, 150 * CM, -3], k.mat("#d9c3a5", { spec: 0.05 }));
        F.windowFrame(k, g, 140, 110, 100, "#2a3b4f");
      });
      L.wall("north", 0.25, (k, g) => F.door(k, g));
      L.wall("north", 0.75, (k, g) => F.windowFrame(k, g, 140, 110, 100, "#2a3b4f"));
      for (const side of ["south", "east", "west"] as const) for (let i = 0; i < 6; i++) L.wall(side, (i + 0.5) / 6, (k, g) => F.fence(k, g, (wallPoint(r, side, 0).len / 6) / CM));
      L.wall("north", 0.12, (k, g) => F.hoseReel(k, g), 10);
      L.wall("north", 0.88, (k, g) => F.wateringCan(k, g), 10);
      L.wall("south", 0.3, (k, g) => F.flowerBed(k, g, 260), 4);
      L.wall("south", 0.7, (k, g) => F.flowerBed(k, g, 260), 4);
      L.wall("east", 0.5, (k, g) => F.bench(k, g), 6);
      L.wall("west", 0.4, (k, g) => F.flowerBed(k, g, 220), 4);
      L.centre(60, (k, g) => F.tree(k, g, 1.1));
      L.centre(40, (k, g) => F.tree(k, g, 0.9));
      L.centre(20, (k, g) => F.birdbath(k, g));
      L.centre(16, (k, g) => F.gnome(k, g));
      for (let i = 0; i < 4; i++) L.centre(22, (k, g) => F.bush(k, g, 1.2), i);
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("grass", { diameterTop: 0, diameterBottom: 0.7, height: 4, tessellation: 3 }, sc), "#3f8f3a", 0.05, 2), count: 2600, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("grass2", { diameterTop: 0, diameterBottom: 0.6, height: 3, tessellation: 3 }, sc), "#5aa84a", 0.05, 1.5), count: 2000, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("pebble", { diameter: 1.8, segments: 6 }, sc), "#9a958c", 0.1, 0.3), count: 220, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("leaf", { diameter: 2.4, segments: 6 }, sc), "#c9822e", 0.05, 0.1), count: 160, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("daisy", { diameter: 1.4, segments: 6 }, sc), "#ffffff", 0.2, 1.6), count: 300 },
      ], 19);
      break;
    }
    case "sandbox": {
      for (const side of ["north", "south", "east", "west"] as const) {
        L.wall(side, 0.5, (k, g) => k.box(g, [wallPoint(r, side, 0).len, 24 * CM, 14 * CM], [0, 12 * CM, 7 * CM], k.mat("#a0673a", { spec: 0.05 })));
      }
      L.wall("north", 0.3, (k, g) => F.slide(k, g), 10);
      L.wall("north", 0.75, (k, g) => F.swingSet(k, g), 10);
      L.wall("east", 0.3, (k, g) => F.bucketSpade(k, g, "#e2413b"), 8);
      L.wall("east", 0.7, (k, g) => F.beachUmbrella(k, g), 30);
      L.wall("west", 0.5, (k, g) => F.bench(k, g), 6);
      L.wall("south", 0.3, (k, g) => F.tree(k, g, 1), 40);
      L.wall("south", 0.7, (k, g) => F.bucketSpade(k, g, "#2f7de1"), 8);
      L.centre(45, (k, g) => F.paddlingPool(k, g, 220));
      for (let i = 0; i < 3; i++) L.centre(18, (k, g) => F.sandCastle(k, g), i);
      L.centre(14, (k, g) => F.beachBall(k, g, 0, 20 * CM));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateSphere("shell", { diameter: 2, segments: 8 }, sc), "#f6d7c3", 0.4, 0.3), count: 120, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("pebble", { diameter: 1.5, segments: 6 }, sc), "#b0a28a", 0.1, 0.25), count: 260 },
        { mesh: mk(k, () => MeshBuilder.CreateBox("mould", { width: 4, height: 2.5, depth: 4 }, sc), "#d9b878", 0.02, 1.25), count: 25 },
      ], 20);
      break;
    }
  }
}
