import { Matrix, MeshBuilder, Quaternion, Vector3, type Mesh, type TransformNode } from "@babylonjs/core";
import { Rng, type Track, type TrackTheme } from "@rc/game-core";
import * as F from "./furniture.js";
import { CM } from "./furniture.js";
import type { Kit } from "./kit.js";
import type { ModelId } from "./models.js";
import type { SurfaceId } from "../materials.js";

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

interface ModelOpts {
  rotY?: number;
  scale?: number;
  /** Sideways along the wall, height off the floor (e.g. on a counter), in real cm. */
  xCm?: number;
  yCm?: number;
}

/** A scanned prop; `zCm` pushes its centre out from the wall (about half its depth). */
const M =
  (id: ModelId, zCm = 0, o: ModelOpts = {}): Builder =>
  (k, g) => {
    k.model(g, id, [(o.xCm ?? 0) * CM, (o.yCm ?? 0) * CM, zCm * CM], o);
  };

/** Several builders into one piece (e.g. a desk with its chair and lamp). */
const all =
  (...builders: Builder[]): Builder =>
  (k, g) => {
    for (const b of builders) b(k, g);
  };

class Layout {
  readonly taken: { x: number; y: number; r: number }[] = [];
  constructor(readonly k: Kit, readonly track: Track, readonly r: Room) {}

  /** Stand a piece against a wall; `fromWallCm` pushes it out (e.g. wall-hung items use 0). */
  wall(side: Side, t: number, build: Builder, fromWallCm = 0, heightCm = 0): void {
    const p = wallPoint(this.r, side, t);
    const g = this.k.facing("wall-item", p.x + p.nx * fromWallCm * CM, p.y + p.ny * fromWallCm * CM, p.nx, p.ny, heightCm * CM);
    build(this.k, g);
    this.guard(g);
  }

  /**
   * Never let furniture intrude on the racing line: drop any piece whose
   * footprint touches the track (checked again once scanned models load).
   */
  private guard(g: TransformNode): void {
    this.k.finish(g);
    if (this.blocksTrack(g)) {
      g.dispose(false, true);
      return;
    }
    void this.k.whenLoaded(g).then(() => {
      if (!g.isDisposed() && this.blocksTrack(g)) g.dispose(false, true);
    });
  }

  private blocksTrack(g: TransformNode): boolean {
    if (g.getChildMeshes(false).length === 0) return false;
    const { min, max } = g.getHierarchyBoundingVectors(true);
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
    this.guard(g);
  }
}

// ------------------------------------------------------------------ shell (walls, ceiling, light)

export interface RoomStyle {
  wall: string;
  wallLower?: string;
  /** Scanned finish of the lower wall (painted plaster unless tiled, panelled or blockwork). */
  lowerSurface?: SurfaceId;
  upperSurface?: SurfaceId;
  baseboard: string;
  ceiling: string;
}

const ROOM_STYLES: Partial<Record<TrackTheme, RoomStyle>> = {
  "toy-track": { wall: "#f3d9b1", wallLower: "#9fc5e8", baseboard: "#ffffff", ceiling: "#f7f3ea" },
  rug: { wall: "#e9dcc8", baseboard: "#f7f3ea", ceiling: "#f7f3ea" },
  kitchen: { wall: "#f1efe9", wallLower: "#e4ece9", lowerSurface: "wall-tiles", baseboard: "#d8d3c8", ceiling: "#ffffff" },
  "toy-canyon": { wall: "#c7dcf2", wallLower: "#f6e7a6", baseboard: "#ffffff", ceiling: "#ffffff" },
  bathroom: { wall: "#e3eef0", wallLower: "#c9e2e6", lowerSurface: "wall-tiles", baseboard: "#ffffff", ceiling: "#ffffff" },
  bedroom: { wall: "#f2d5dd", baseboard: "#ffffff", ceiling: "#ffffff" },
  workshop: { wall: "#c4c6c8", wallLower: "#b0b3b6", upperSurface: "block-wall", lowerSurface: "block-wall", baseboard: "#4b5157", ceiling: "#8a9097" },
  library: { wall: "#7a5a46", wallLower: "#6b4330", lowerSurface: "panelling", baseboard: "#2a1d15", ceiling: "#e9dcc8" },
};

function buildShell(k: Kit, r: Room, style: RoomStyle): void {
  const g = k.group("room-shell", 0, 0);
  const w = r.x1 - r.x0;
  const d = r.y1 - r.y0;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const H = r.height;
  // Painted plaster walls (matt emulsion); kitchens/bathrooms tiled below, the library panelled.
  const wall = k.mat(style.wall, { surface: style.upperSurface ?? "plaster" });
  const lower = k.mat(style.wallLower ?? style.wall, { surface: style.lowerSurface ?? "plaster", rough: style.lowerSurface === "wall-tiles" ? 0.35 : undefined });
  const base = k.mat(style.baseboard, { rough: 0.4, surface: "none" });
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
  k.box(g, [w, 2, d], [cx, H, cy], k.mat(style.ceiling, { surface: "plaster" }));
  // Ceiling lights.
  for (const fx of [0.3, 0.7]) for (const fy of [0.35, 0.65]) {
    const x = r.x0 + w * fx;
    const y = r.y0 + d * fy;
    k.cyl(g, 50 * CM, 4 * CM, [x, H - 2 * CM, y], k.mat("#fff6dc", { emissive: 1.4 }));
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
    m.material = k.mat(hex, { spec, surface: "none" });
    m.bakeTransformIntoVertices(Matrix.Translation(0, y, 0));
    return m;
  };
}

/** Scanned props dropped on the floor beside the racing line (rubber ducks, shells, stones…). */
function scatterModels(k: Kit, track: Track, items: { id: ModelId; count: number; scale?: [number, number] }[], seed: number): void {
  const rng = new Rng(seed);
  for (const item of items) {
    for (let n = 0, attempt = 0; n < item.count && attempt < item.count * 8; attempt++) {
      const pose = track.poseAt(rng.range(0, track.length));
      const side = rng.next() < 0.5 ? 1 : -1;
      const off = track.halfWidth + rng.range(6, 26);
      const x = pose.x - Math.sin(pose.heading) * off * side;
      const y = pose.y + Math.cos(pose.heading) * off * side;
      if (trackClearance(track, x, y) < 5) continue;
      const g = k.group(`scatter-${item.id}`, x, y);
      const [lo, hi] = item.scale ?? [1, 1];
      k.model(g, item.id, [0, 0, 0], { rotY: rng.range(0, Math.PI * 2), scale: rng.range(lo, hi) });
      n++;
    }
  }
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
        F.toaster(k, g, 120 * CM, 92 * CM, 25 * CM);
        M("vintage_electric_kettle", 25, { xCm: 85, yCm: 90.5, rotY: 0.4 })(k, g);
        M("wooden_cutting_board", 30, { xCm: -60, yCm: 90.5, rotY: 0.15 })(k, g);
        M("bananas", 30, { xCm: -110, yCm: 90.5, rotY: 1.2 })(k, g);
        M("lemon", 40, { xCm: -95, yCm: 90.5 })(k, g);
        M("food_apple_01", 22, { xCm: -122, yCm: 90.5 })(k, g);
      });
      L.wall("north", 0.3, (k, g) => F.windowFrame(k, g, 140, 110, 110));
      L.wall("north", 0.58, (k, g) => {
        F.counterRun(k, g, 120);
        M("vintage_microwave", 30, { xCm: -20, yCm: 90.5 })(k, g);
        M("tea_set_01", 32, { xCm: 38, yCm: 90.5, rotY: 0.3 })(k, g);
        F.upperCabinets(k, g, 120);
      });
      L.wall("north", 0.74, M("electric_stove", 34));
      L.wall("north", 0.74, (k, g) => F.rangeHood(k, g));
      L.wall("north", 0.86, (k, g) => F.fridge(k, g));
      // East wall: laundry corner.
      L.wall("east", 0.2, (k, g) => F.washingMachine(k, g));
      L.wall("east", 0.33, (k, g) => F.washingMachine(k, g, true));
      L.wall("east", 0.33, (k, g) => F.washingMachine(k, g, true), 0, 86);
      L.wall("east", 0.48, M("wicker_basket_01", 20));
      L.wall("east", 0.7, (k, g) => F.door(k, g));
      L.wall("east", 0.88, (k, g) => F.radiator(k, g));
      // South & west: dresser, plant, bin, pet bowls, pictures.
      L.wall("south", 0.15, (k, g) => F.trashBin(k, g));
      L.wall("south", 0.35, M("potted_plant_02", 36));
      L.wall("south", 0.55, (k, g) => F.bookshelf(k, g, 100, 180, "#e8e2d6"));
      L.wall("south", 0.75, (k, g) => F.picture(k, g, 60, 45, 160, "#7fb3d5"));
      L.wall("west", 0.3, (k, g) => F.windowFrame(k, g, 120, 120, 90));
      L.wall("west", 0.6, (k, g) => F.petBowl(k, g, 0, 20 * CM));
      L.wall("west", 0.8, (k, g) => F.clock(k, g, 190));
      L.centre(78, (k, g) => {
        k.model(g, "round_wooden_table_01");
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + 0.3;
          k.model(g, "dining_chair_02", [Math.sin(a) * 80 * CM, 0, Math.cos(a) * 80 * CM], { rotY: a + Math.PI });
        }
        k.model(g, "food_apple_01", [10 * CM, 100.5 * CM, -6 * CM]);
        k.model(g, "food_apple_01", [-4 * CM, 100.5 * CM, 8 * CM], { rotY: 2 });
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
      L.wall("north", 0.35, all(M("Sofa_01", 40), M("throw_pillows_01", 40, { yCm: 42 })));
      L.wall("north", 0.12, (k, g) => F.floorLamp(k, g));
      L.wall("north", 0.6, M("ArmChair_01", 45, { rotY: -0.3 }));
      L.wall("north", 0.6, M("Ottoman_01", 120));
      L.wall("north", 0.72, all(M("side_table_01", 30), M("potted_plant_04", 30, { yCm: 55 })));
      L.wall("north", 0.84, M("potted_plant_02", 36));
      L.wall("south", 0.4, (k, g) => {
        F.tvStand(k, g, false);
        M("Television_01", 22, { yCm: 50 })(k, g);
      });
      L.wall("south", 0.7, (k, g) => F.bookshelf(k, g));
      L.wall("south", 0.88, (k, g) => F.bookshelf(k, g));
      L.wall("east", 0.3, (k, g) => F.windowFrame(k, g, 160, 140, 70));
      L.wall("east", 0.7, (k, g) => F.windowFrame(k, g, 160, 140, 70));
      L.wall("east", 0.5, (k, g) => F.radiator(k, g));
      L.wall("west", 0.25, (k, g) => F.door(k, g));
      L.wall("west", 0.6, M("hanging_picture_frame_01", 2, { yCm: 120 }));
      L.wall("west", 0.8, M("ornate_mirror_01", 2, { yCm: 110 }));
      L.wall("south", 0.18, (k, g) => F.toyBox(k, g));
      L.centre(60, all(M("CoffeeTable_01"), M("gamepad", 0, { yCm: 52.5, rotY: 0.6 })));
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
      L.wall("north", 0.82, all(M("GreenChair_01", 40, { rotY: -0.4 }), M("Ukulele_01", 20, { xCm: 60, rotY: 0.3 })));
      L.wall("east", 0.3, (k, g) => F.toyBlocksTower(k, g, 8));
      L.wall("east", 0.6, (k, g) => F.poster(k, g, 160, "#2f7de1", "#ffc933"));
      L.wall("east", 0.8, (k, g) => F.door(k, g));
      L.wall("south", 0.3, (k, g) => F.bed(k, g, "#3ddc84"));
      L.wall("south", 0.7, all(M("SchoolDesk_01", 30), M("SchoolChair_01", 75, { rotY: Math.PI }), M("alarm_clock_01", 22, { xCm: 20, yCm: 75 })));
      L.wall("west", 0.3, (k, g) => F.poster(k, g, 160, "#e2413b", "#f2f2f2"));
      L.wall("west", 0.6, (k, g) => F.toyBlocksTower(k, g, 5));
      L.wall("west", 0.8, M("cardboard_box_01", 25, { rotY: 0.2 }));
      L.centre(30, (k, g) => F.toyBox(k, g));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#ffc933", 0.4, 0.6), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego2", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#3ddc84", 0.4, 0.6), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("crayon", { diameter: 0.8, height: 6, tessellation: 6 }, sc), "#c45bff", 0.3, 0), count: 40, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("marble", { diameter: 1.4, segments: 8 }, sc), "#26d7d7", 1, 0.7), count: 50 },
      ], 13);
      scatterModels(k, track, [{ id: "football", count: 2 }, { id: "baseball_01", count: 3 }, { id: "rubber_duck_toy", count: 3 }], 113);
      break;
    }
    case "toy-canyon": {
      L.wall("north", 0.3, (k, g) => F.bed(k, g, "#2f7de1"));
      L.wall("north", 0.65, M("painted_wooden_cabinet", 32));
      L.wall("north", 0.85, all(M("painted_wooden_nightstand", 27), M("alarm_clock_01", 25, { yCm: 61.5, rotY: -0.3 })));
      L.wall("east", 0.4, all(M("SchoolDesk_01", 30), M("SchoolChair_01", 75, { rotY: Math.PI }), M("gamepad", 25, { xCm: -15, yCm: 75, rotY: 0.4 })));
      L.wall("east", 0.7, (k, g) => F.windowFrame(k, g, 150, 130, 80));
      L.wall("south", 0.2, (k, g) => F.toyBox(k, g));
      L.wall("south", 0.45, (k, g) => F.poster(k, g, 160, "#c45bff", "#ffc933"));
      L.wall("south", 0.7, (k, g) => F.bookshelf(k, g, 90, 160, "#f2ead8"));
      L.wall("west", 0.3, (k, g) => F.door(k, g));
      L.wall("west", 0.65, all(M("american_football", 30, { rotY: 0.7 }), M("wooden_stool_01", 30, { xCm: 60 })));
      for (let i = 0; i < 4; i++) L.centre(22, (k, g) => F.toyBox(k, g), i);
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#e2413b", 0.4, 0.6), count: 120, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("marble", { diameter: 1.4, segments: 8 }, sc), "#ffc933", 1, 0.7), count: 50 },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("sock", { diameter: 3, height: 8, tessellation: 8 }, sc), "#f2f2f2", 0.02, 0), count: 6, tilt: true },
      ], 14);
      scatterModels(k, track, [{ id: "baseball_01", count: 4 }, { id: "football", count: 1 }], 114);
      break;
    }
    case "bathroom": {
      L.wall("north", 0.35, (k, g) => F.bathtub(k, g));
      L.wall("north", 0.7, (k, g) => F.towelRail(k, g));
      L.wall("north", 0.88, (k, g) => F.radiator(k, g));
      L.wall("east", 0.3, (k, g) => F.toilet(k, g));
      L.wall("east", 0.6, (k, g) => F.vanity(k, g));
      L.wall("east", 0.85, M("wicker_basket_01", 20));
      L.wall("east", 0.6, all(M("bleach_bottle", 50, { xCm: -55 }), M("all_purpose_cleaner", 55, { xCm: -42, rotY: 0.5 })));
      L.wall("east", 0.42, M("plunger", 20));
      L.wall("south", 0.3, (k, g) => F.windowFrame(k, g, 100, 80, 130, "#dff1ff"));
      L.wall("south", 0.6, (k, g) => F.washingMachine(k, g));
      L.wall("south", 0.8, M("potted_plant_04", 20, { scale: 1.6 }));
      L.wall("south", 0.45, M("WetFloorSign_01", 40, { rotY: 0.5 }));
      L.wall("west", 0.4, (k, g) => F.door(k, g));
      L.wall("west", 0.75, (k, g) => F.towelRail(k, g));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateBox("soap", { width: 3, height: 1, depth: 2 }, sc), "#ff9fbf", 0.5, 0.5), count: 14, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("bud", { diameter: 0.25, height: 3, tessellation: 6 }, sc), "#f2f2f2", 0.1, 0), count: 50, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("bubble", { diameter: 1.5, segments: 8 }, sc), "#e8f6ff", 1, 0.75), count: 90 },
      ], 15);
      scatterModels(k, track, [{ id: "rubber_duck_toy", count: 10, scale: [0.8, 1.2] }], 115);
      break;
    }
    case "bedroom": {
      L.wall("north", 0.35, (k, g) => F.bed(k, g, "#ff6fb5"));
      L.wall("north", 0.12, all(M("painted_wooden_nightstand", 27), M("alarm_clock_01", 25, { yCm: 61.5, rotY: 0.3 })));
      L.wall("north", 0.62, all(M("painted_wooden_nightstand", 27), M("desk_lamp_arm_01", 25, { yCm: 61.5, scale: 0.6 })));
      L.wall("north", 0.84, M("vintage_cabinet_01", 36, { scale: 0.85 }));
      L.wall("east", 0.3, all((k, g) => F.desk(k, g, false), M("painted_wooden_chair_01", 75, { rotY: Math.PI })));
      L.wall("east", 0.6, (k, g) => F.windowFrame(k, g, 160, 130, 80));
      L.wall("east", 0.85, (k, g) => F.bookshelf(k, g, 80, 180, "#f2ead8"));
      L.wall("south", 0.25, (k, g) => F.toyBox(k, g));
      L.wall("south", 0.5, (k, g) => F.poster(k, g, 160, "#3ddc84", "#2f7de1"));
      L.wall("south", 0.75, M("GreenChair_01", 40));
      L.wall("west", 0.3, (k, g) => F.door(k, g));
      L.wall("west", 0.6, (k, g) => F.floorLamp(k, g));
      L.wall("west", 0.8, M("ornate_mirror_01", 2, { yCm: 100 }));
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("pencil", { diameter: 0.7, height: 7, tessellation: 6 }, sc), "#ffc933", 0.3, 0), count: 40, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("lego", { width: 2.4, height: 1.2, depth: 1.2 }, sc), "#c45bff", 0.4, 0.6), count: 90, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateBox("paper", { width: 8, height: 0.1, depth: 11 }, sc), "#ffffff", 0.05, 0.05), count: 12 },
      ], 16);
      break;
    }
    case "workshop": {
      L.wall("north", 0.3, all((k, g) => F.workbench(k, g), M("Drill_01", 40, { xCm: 20, yCm: 93, rotY: 1.2 }), M("spray_paint_bottles", 30, { xCm: -70, yCm: 93 })));
      L.wall("north", 0.6, M("metal_tool_chest", 22));
      L.wall("north", 0.8, M("steel_frame_shelves_01", 27));
      L.wall("east", 0.5, (k, g) => F.garageDoor(k, g, 260));
      L.wall("east", 0.15, all(M("old_tyre", 10, { rotY: 0.1 }), M("old_tyre", 28, { xCm: 40, rotY: -0.2 })));
      L.wall("east", 0.85, all(M("Barrel_01", 30), M("Barrel_02", 30, { xCm: 60 })));
      L.wall("east", 0.7, M("portable_generator", 32, { rotY: 0.2 }));
      L.wall("south", 0.25, M("steel_frame_shelves_01", 27));
      L.wall("south", 0.5, M("wooden_ladder", 30, { rotY: 0.1 }));
      L.wall("south", 0.75, all(M("wooden_crate_01", 22), M("cardboard_box_01", 25, { xCm: 70, rotY: 0.3 })));
      L.wall("west", 0.3, (k, g) => F.door(k, g));
      L.wall("west", 0.5, all(M("metal_jerrycan", 12), M("tire_pump", 15, { xCm: 35 })));
      L.wall("west", 0.6, M("Barrel_01", 30));
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
      L.wall("east", 0.55, M("Rockingchair_01", 50, { rotY: -0.4 }));
      L.wall("east", 0.4, M("mid_century_lounge_chair", 60, { rotY: 0.3 }));
      L.wall("east", 0.75, (k, g) => F.floorLamp(k, g));
      L.wall("west", 0.3, all((k, g) => F.desk(k, g, false), M("vintage_oil_lamp", 25, { xCm: 40, yCm: 75 }), M("marble_bust_01", 25, { xCm: -40, yCm: 75 })));
      L.wall("west", 0.55, (k, g) => F.globe(k, g));
      L.wall("west", 0.75, M("vintage_grandfather_clock_01", 42));
      L.wall("west", 0.88, (k, g) => F.plant(k, g, 0, 25 * CM, 1.3));
      for (let i = 0; i < 3; i++) L.centre(14, (k, g) => F.bookStack(k, g, 6 + i * 2), i);
      for (let i = 0; i < 2; i++) L.centre(26, M("book_encyclopedia_set_01"), i * 1.3);
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
      L.wall("north", 0.88, M("watering_can_metal_01", 30));
      L.wall("north", 0.4, M("planter_box_01", 25));
      L.wall("north", 0.6, M("planter_box_01", 25));
      L.wall("north", 0.7, all(M("planter_pot_clay", 20), M("planter_pot_clay", 20, { xCm: 32, scale: 0.8 })));
      L.wall("south", 0.3, all(M("planter_box_01", 25), M("fern_02", 70, { scale: 0.5, xCm: 60 })));
      L.wall("south", 0.7, all(M("planter_box_01", 25), M("planter_pot_clay", 25, { xCm: -70 })));
      L.wall("east", 0.5, M("painted_wooden_bench", 30));
      L.wall("west", 0.4, all(M("shrub_02", 60, { scale: 0.35 }), M("planter_pot_clay", 20, { xCm: 90, scale: 1.2 })));
      L.centre(60, (k, g) => F.tree(k, g, 1.1));
      L.centre(40, (k, g) => F.tree(k, g, 0.9));
      L.centre(20, (k, g) => F.birdbath(k, g));
      L.centre(16, M("garden_gnome"));
      L.centre(55, M("tree_stump_01"));
      for (let i = 0; i < 4; i++) L.centre(40, M("fern_02", 0, { scale: 0.7 }), i);
      scatter(k, track, r, [
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("grass", { diameterTop: 0, diameterBottom: 0.7, height: 4, tessellation: 3 }, sc), "#3f8f3a", 0.05, 2), count: 2600, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateCylinder("grass2", { diameterTop: 0, diameterBottom: 0.6, height: 3, tessellation: 3 }, sc), "#5aa84a", 0.05, 1.5), count: 2000, near: true, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("pebble", { diameter: 1.8, segments: 6 }, sc), "#9a958c", 0.1, 0.3), count: 220, near: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("leaf", { diameter: 2.4, segments: 6 }, sc), "#c9822e", 0.05, 0.1), count: 160, tilt: true },
        { mesh: mk(k, () => MeshBuilder.CreateSphere("daisy", { diameter: 1.4, segments: 6 }, sc), "#ffffff", 0.2, 1.6), count: 300 },
      ], 19);
      scatterModels(k, track, [{ id: "stone_01", count: 14, scale: [0.6, 1.3] }], 119);
      break;
    }
    case "sandbox": {
      for (const side of ["north", "south", "east", "west"] as const) {
        L.wall(side, 0.5, (k, g) => k.box(g, [wallPoint(r, side, 0).len, 24 * CM, 14 * CM], [0, 12 * CM, 7 * CM], k.mat("#a0673a", { spec: 0.05 })));
      }
      L.wall("north", 0.3, (k, g) => F.slide(k, g), 10);
      L.wall("north", 0.75, (k, g) => F.swingSet(k, g), 10);
      L.wall("east", 0.3, M("wooden_bucket_01", 25));
      L.wall("east", 0.7, (k, g) => F.beachUmbrella(k, g), 30);
      L.wall("west", 0.5, M("painted_wooden_bench", 30));
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
      scatterModels(k, track, [{ id: "lambis_shell", count: 12, scale: [0.8, 1.4] }, { id: "rubber_duck_toy", count: 3 }, { id: "football", count: 1 }], 120);
      break;
    }
  }
}
