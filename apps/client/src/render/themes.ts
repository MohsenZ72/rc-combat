import type { TrackTheme } from "@rc/game-core";

export type FloorKind = "planks" | "carpet" | "tiles" | "mosaic" | "grass" | "concrete" | "parquet" | "sand" | "pinkcarpet";

/**
 * Visual settings per track theme. Everything is a toy-scale house: the cars
 * are diecast toys and the "roads" are toy track, a rug, tiles, a dirt path…
 * There is no asphalt anywhere. Rooms (walls, furniture, clutter) are built
 * by render/room/rooms.ts.
 */
export interface ThemeStyle {
  label: string;
  clear: string;
  fog: string;
  fogDensity: number;
  floor: FloorKind;
  /** Racing surface: toy-track plastic, the rug, a dirt path, or the floor itself continued. */
  surface: "plastic-orange" | "plastic-blue" | "rug" | "floor" | "dirt";
  barrier: "rail" | "blocks";
  barrierColors: string[];
  /** Block size [w, h, d] and random height variation (books, stones). */
  block: [number, number, number];
  blockVariation: number;
  railColor: string;
  skirt: "none" | "rug" | "wood" | "grass" | "sand";
  pillars: boolean;
  ramp: string;
  water: string;
  waterAlpha: number;
  pond: boolean;
  outdoor: boolean;
  sunIntensity: number;
  hemiIntensity: number;
}

const base = {
  fogDensity: 0.0012,
  block: [1.6, 2.8, 1.6] as [number, number, number],
  blockVariation: 0,
  waterAlpha: 0.38,
  pond: false,
  outdoor: false,
  pillars: false,
  skirt: "none" as const,
  sunIntensity: 0.9,
  hemiIntensity: 0.8,
};

export const THEMES: Record<TrackTheme, ThemeStyle> = {
  "toy-track": {
    ...base,
    label: "Toy track in the playroom",
    clear: "#2a2118",
    fog: "#3a2e22",
    floor: "planks",
    surface: "plastic-orange",
    barrier: "rail",
    barrierColors: [],
    railColor: "#ff7a1a",
    ramp: "#ffb21a",
    water: "#4fb7ff",
  },
  rug: {
    ...base,
    label: "Living-room rug",
    clear: "#2b211b",
    fog: "#3b2e25",
    floor: "planks",
    surface: "rug",
    barrier: "blocks",
    barrierColors: ["#e2413b", "#f4c430", "#2f7de1", "#3dbb5c"],
    railColor: "#e2413b",
    skirt: "rug",
    ramp: "#7b3f99",
    water: "#4fb7ff",
    sunIntensity: 0.85,
  },
  kitchen: {
    ...base,
    label: "Kitchen floor tiles",
    clear: "#1f282d",
    fog: "#2a3439",
    floor: "tiles",
    surface: "floor",
    barrier: "blocks",
    barrierColors: ["#ffffff", "#7fd1c7", "#ffb4a2", "#ffe08a"],
    railColor: "#7fd1c7",
    skirt: "wood",
    ramp: "#c98b4e",
    water: "#5cc8ff",
    pond: true,
    sunIntensity: 1,
  },
  "toy-canyon": {
    ...base,
    label: "Toy track canyon in the kids' room",
    clear: "#1b2230",
    fog: "#262f40",
    floor: "carpet",
    surface: "plastic-blue",
    barrier: "rail",
    barrierColors: [],
    railColor: "#2f7de1",
    pillars: true,
    ramp: "#ffd21a",
    water: "#4fd1ff",
    pond: true,
  },
  bathroom: {
    ...base,
    label: "Bathroom mosaic",
    clear: "#1d2a30",
    fog: "#2a3a42",
    floor: "mosaic",
    surface: "floor",
    barrier: "blocks",
    barrierColors: ["#ffffff", "#9fd0d8", "#ffd21a", "#ff9fbf"],
    railColor: "#9fd0d8",
    skirt: "wood",
    ramp: "#ff9fbf",
    water: "#7fdcff",
    waterAlpha: 0.45,
    pond: true,
    sunIntensity: 1,
    hemiIntensity: 0.9,
  },
  garden: {
    ...base,
    label: "Back garden",
    clear: "#9fd4ff",
    fog: "#cde8ff",
    fogDensity: 0.0008,
    floor: "grass",
    surface: "dirt",
    barrier: "blocks",
    barrierColors: ["#9a958c", "#b9b5ad", "#857f75", "#a8a39a"],
    block: [2.2, 2.8, 1.8],
    blockVariation: 0.5,
    railColor: "#9a958c",
    skirt: "grass",
    ramp: "#8a5a36",
    water: "#6fa7c9",
    waterAlpha: 0.55,
    pond: true,
    outdoor: true,
    sunIntensity: 1.25,
    hemiIntensity: 1,
  },
  bedroom: {
    ...base,
    label: "Bedroom carpet",
    clear: "#2a1f26",
    fog: "#3a2c35",
    floor: "pinkcarpet",
    surface: "floor",
    barrier: "blocks",
    barrierColors: ["#ff6fb5", "#c45bff", "#ffc933", "#26d7d7"],
    railColor: "#ff6fb5",
    skirt: "rug",
    ramp: "#2f7de1",
    water: "#4fb7ff",
  },
  workshop: {
    ...base,
    label: "Garage workshop",
    clear: "#181a1d",
    fog: "#25282c",
    floor: "concrete",
    surface: "floor",
    barrier: "blocks",
    barrierColors: ["#b5835a", "#9c6d48", "#c8331f", "#7a828c"],
    block: [2.4, 2.8, 1.2],
    blockVariation: 0.25,
    railColor: "#b5835a",
    skirt: "wood",
    ramp: "#b5835a",
    water: "#1a1410",
    waterAlpha: 0.75,
    pond: true,
    sunIntensity: 0.8,
    hemiIntensity: 0.75,
  },
  library: {
    ...base,
    label: "Library parquet",
    clear: "#1c140f",
    fog: "#2a1f17",
    floor: "parquet",
    surface: "floor",
    barrier: "blocks",
    barrierColors: ["#7d1f24", "#1e2b4f", "#1f6b4a", "#c0a062", "#5b3a6e", "#d9a441"],
    block: [1.1, 3.2, 2.2],
    blockVariation: 0.35,
    railColor: "#7d1f24",
    skirt: "wood",
    ramp: "#1e2b4f",
    water: "#4fb7ff",
    sunIntensity: 0.75,
    hemiIntensity: 0.7,
  },
  sandbox: {
    ...base,
    label: "Playground sandbox",
    clear: "#a7d8ff",
    fog: "#d7ecff",
    fogDensity: 0.0007,
    floor: "sand",
    surface: "floor",
    barrier: "blocks",
    barrierColors: ["#a0673a", "#8a5a36", "#b5835a"],
    block: [2.6, 2.6, 2.6],
    blockVariation: 0.2,
    railColor: "#a0673a",
    skirt: "sand",
    ramp: "#ffc933",
    water: "#5cc8ff",
    waterAlpha: 0.5,
    pond: true,
    outdoor: true,
    sunIntensity: 1.3,
    hemiIntensity: 1,
  },
};
