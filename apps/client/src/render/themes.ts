import type { TrackTheme } from "@rc/game-core";

/**
 * Visual settings per track theme. Everything is a toy-scale house: the cars
 * are diecast toys and the "roads" are toy track pieces, a rug or kitchen
 * tiles. There is no asphalt anywhere.
 */
export interface ThemeStyle {
  label: string;
  clear: string;
  fog: string;
  floor: "planks" | "carpet" | "tiles";
  /** Racing surface: its own texture, or the floor itself continued (no visible road). */
  surface: "plastic-orange" | "plastic-blue" | "rug" | "tiles";
  barrier: "rail" | "blocks";
  barrierColors: string[];
  railColor: string;
  skirt: "none" | "rug" | "wood";
  pillars: boolean;
  props: ("blocks" | "balls" | "toybox" | "sofa" | "cushion" | "book" | "mug" | "fridge" | "tableLeg" | "fruit" | "cereal" | "bowl")[];
  ramp: string;
  water: string;
  pond: boolean;
  sunIntensity: number;
}

export const THEMES: Record<TrackTheme, ThemeStyle> = {
  "toy-track": {
    label: "Toy track on the playroom floor",
    clear: "#1a1410",
    fog: "#2a1f17",
    floor: "planks",
    surface: "plastic-orange",
    barrier: "rail",
    barrierColors: [],
    railColor: "#ff7a1a",
    skirt: "none",
    pillars: false,
    props: ["blocks", "balls", "toybox"],
    ramp: "#ffb21a",
    water: "#4fb7ff",
    pond: false,
    sunIntensity: 0.9,
  },
  rug: {
    label: "Living-room rug",
    clear: "#1b1512",
    fog: "#2b211b",
    floor: "planks",
    surface: "rug",
    barrier: "blocks",
    barrierColors: ["#e2413b", "#f4c430", "#2f7de1", "#3dbb5c"],
    railColor: "#e2413b",
    skirt: "rug",
    pillars: false,
    props: ["sofa", "cushion", "book", "mug"],
    ramp: "#7b3f99",
    water: "#4fb7ff",
    pond: false,
    sunIntensity: 0.85,
  },
  kitchen: {
    label: "Kitchen floor tiles",
    clear: "#151a1d",
    fog: "#1f282d",
    floor: "tiles",
    surface: "tiles",
    barrier: "blocks",
    barrierColors: ["#ffffff", "#7fd1c7", "#ffb4a2", "#ffe08a"],
    railColor: "#7fd1c7",
    skirt: "wood",
    pillars: false,
    props: ["fridge", "tableLeg", "fruit", "cereal", "bowl"],
    ramp: "#c98b4e",
    water: "#5cc8ff",
    pond: true,
    sunIntensity: 1,
  },
  "toy-canyon": {
    label: "Toy track canyon",
    clear: "#12161f",
    fog: "#1b2230",
    floor: "carpet",
    surface: "plastic-blue",
    barrier: "rail",
    barrierColors: [],
    railColor: "#2f7de1",
    skirt: "none",
    pillars: true,
    props: ["blocks", "toybox", "balls"],
    ramp: "#ffd21a",
    water: "#4fd1ff",
    pond: true,
    sunIntensity: 0.9,
  },
};
