import type { BodyId } from "@rc/shared";

/** One station of a lofted shell: x along the car (+x = nose), half width, underside and roof line. */
export interface Station {
  x: number;
  hw: number;
  bottom: number;
  top: number;
}

export type BodyExtra = "wing" | "scoop" | "roofrack" | "bed" | "bullbar" | "rollcage" | "ducktail";

export interface BodyDef {
  label: string;
  shell: Station[];
  cabin: Station[];
  /** Wheel centres (x front/rear, z half track) and base wheel radius. */
  wheelX: [number, number];
  wheelZ: number;
  wheelRadius: number;
  extras: BodyExtra[];
}

/**
 * Eight diecast body styles, all inside the same 2.6 m × 1.5 m footprint the
 * server simulates (collision radius 1.3 m) — taller or shorter is visual only.
 */
export const BODY_DEFS: Record<BodyId, BodyDef> = {
  supercar: {
    label: "Supercar",
    shell: [
      { x: -1.32, hw: 0.05, bottom: 0.3, top: 0.4 },
      { x: -1.3, hw: 0.62, bottom: 0.22, top: 0.62 },
      { x: -1.0, hw: 0.72, bottom: 0.2, top: 0.66 },
      { x: -0.3, hw: 0.73, bottom: 0.2, top: 0.6 },
      { x: 0.4, hw: 0.72, bottom: 0.2, top: 0.52 },
      { x: 1.0, hw: 0.66, bottom: 0.2, top: 0.42 },
      { x: 1.3, hw: 0.56, bottom: 0.22, top: 0.33 },
      { x: 1.33, hw: 0.05, bottom: 0.26, top: 0.3 },
    ],
    cabin: [
      { x: -0.75, hw: 0.05, bottom: 0.6, top: 0.62 },
      { x: -0.7, hw: 0.5, bottom: 0.58, top: 0.8 },
      { x: -0.2, hw: 0.56, bottom: 0.56, top: 0.92 },
      { x: 0.25, hw: 0.54, bottom: 0.52, top: 0.86 },
      { x: 0.62, hw: 0.46, bottom: 0.48, top: 0.56 },
      { x: 0.66, hw: 0.05, bottom: 0.48, top: 0.5 },
    ],
    wheelX: [0.84, -0.84],
    wheelZ: 0.66,
    wheelRadius: 0.33,
    extras: ["wing"],
  },
  muscle: {
    label: "Muscle",
    shell: [
      { x: -1.32, hw: 0.05, bottom: 0.3, top: 0.45 },
      { x: -1.3, hw: 0.66, bottom: 0.22, top: 0.7 },
      { x: -0.8, hw: 0.74, bottom: 0.2, top: 0.72 },
      { x: 0.2, hw: 0.74, bottom: 0.2, top: 0.66 },
      { x: 1.0, hw: 0.72, bottom: 0.2, top: 0.62 },
      { x: 1.3, hw: 0.66, bottom: 0.22, top: 0.55 },
      { x: 1.33, hw: 0.05, bottom: 0.3, top: 0.45 },
    ],
    cabin: [
      { x: -0.65, hw: 0.05, bottom: 0.68, top: 0.7 },
      { x: -0.6, hw: 0.55, bottom: 0.68, top: 0.95 },
      { x: -0.05, hw: 0.58, bottom: 0.66, top: 1.0 },
      { x: 0.4, hw: 0.54, bottom: 0.64, top: 0.72 },
      { x: 0.44, hw: 0.05, bottom: 0.64, top: 0.66 },
    ],
    wheelX: [0.86, -0.86],
    wheelZ: 0.68,
    wheelRadius: 0.36,
    extras: ["scoop", "ducktail"],
  },
  rally: {
    label: "Rally hatch",
    shell: [
      { x: -1.25, hw: 0.05, bottom: 0.3, top: 0.5 },
      { x: -1.22, hw: 0.66, bottom: 0.24, top: 0.72 },
      { x: -0.6, hw: 0.73, bottom: 0.22, top: 0.74 },
      { x: 0.5, hw: 0.73, bottom: 0.22, top: 0.64 },
      { x: 1.15, hw: 0.66, bottom: 0.24, top: 0.52 },
      { x: 1.2, hw: 0.05, bottom: 0.3, top: 0.44 },
    ],
    cabin: [
      { x: -1.05, hw: 0.05, bottom: 0.7, top: 0.72 },
      { x: -1.0, hw: 0.58, bottom: 0.7, top: 1.06 },
      { x: -0.2, hw: 0.6, bottom: 0.68, top: 1.12 },
      { x: 0.35, hw: 0.55, bottom: 0.64, top: 0.76 },
      { x: 0.4, hw: 0.05, bottom: 0.64, top: 0.66 },
    ],
    wheelX: [0.8, -0.8],
    wheelZ: 0.68,
    wheelRadius: 0.36,
    extras: ["roofrack"],
  },
  suv: {
    label: "SUV (tall)",
    shell: [
      { x: -1.3, hw: 0.05, bottom: 0.5, top: 0.8 },
      { x: -1.28, hw: 0.7, bottom: 0.42, top: 1.0 },
      { x: -0.4, hw: 0.76, bottom: 0.4, top: 1.02 },
      { x: 0.7, hw: 0.76, bottom: 0.4, top: 0.98 },
      { x: 1.28, hw: 0.7, bottom: 0.42, top: 0.86 },
      { x: 1.31, hw: 0.05, bottom: 0.5, top: 0.72 },
    ],
    cabin: [
      { x: -1.2, hw: 0.05, bottom: 0.98, top: 1.0 },
      { x: -1.15, hw: 0.66, bottom: 0.98, top: 1.42 },
      { x: 0.2, hw: 0.68, bottom: 0.98, top: 1.46 },
      { x: 0.68, hw: 0.64, bottom: 0.96, top: 1.08 },
      { x: 0.72, hw: 0.05, bottom: 0.96, top: 0.98 },
    ],
    wheelX: [0.86, -0.86],
    wheelZ: 0.72,
    wheelRadius: 0.44,
    extras: ["roofrack", "bullbar"],
  },
  pickup: {
    label: "Pickup",
    shell: [
      { x: -1.32, hw: 0.05, bottom: 0.46, top: 0.72 },
      { x: -1.3, hw: 0.72, bottom: 0.4, top: 0.86 },
      { x: 0.2, hw: 0.75, bottom: 0.38, top: 0.88 },
      { x: 1.0, hw: 0.74, bottom: 0.38, top: 0.86 },
      { x: 1.3, hw: 0.7, bottom: 0.4, top: 0.76 },
      { x: 1.33, hw: 0.05, bottom: 0.46, top: 0.66 },
    ],
    cabin: [
      { x: 0.05, hw: 0.05, bottom: 0.86, top: 0.88 },
      { x: 0.1, hw: 0.66, bottom: 0.86, top: 1.36 },
      { x: 0.55, hw: 0.66, bottom: 0.86, top: 1.36 },
      { x: 0.85, hw: 0.62, bottom: 0.84, top: 0.94 },
      { x: 0.88, hw: 0.05, bottom: 0.84, top: 0.86 },
    ],
    wheelX: [0.88, -0.86],
    wheelZ: 0.72,
    wheelRadius: 0.42,
    extras: ["bed", "bullbar"],
  },
  van: {
    label: "Van",
    shell: [
      { x: -1.3, hw: 0.05, bottom: 0.4, top: 1.0 },
      { x: -1.28, hw: 0.72, bottom: 0.3, top: 1.32 },
      { x: 0.6, hw: 0.74, bottom: 0.28, top: 1.36 },
      { x: 1.05, hw: 0.72, bottom: 0.28, top: 1.1 },
      { x: 1.3, hw: 0.68, bottom: 0.3, top: 0.7 },
      { x: 1.32, hw: 0.05, bottom: 0.36, top: 0.62 },
    ],
    cabin: [
      { x: 0.55, hw: 0.05, bottom: 0.9, top: 0.92 },
      { x: 0.6, hw: 0.7, bottom: 0.88, top: 1.3 },
      { x: 1.05, hw: 0.68, bottom: 0.86, top: 1.08 },
      { x: 1.1, hw: 0.05, bottom: 0.86, top: 0.88 },
    ],
    wheelX: [0.9, -0.9],
    wheelZ: 0.7,
    wheelRadius: 0.35,
    extras: [],
  },
  sedan: {
    label: "Sedan",
    shell: [
      { x: -1.32, hw: 0.05, bottom: 0.3, top: 0.52 },
      { x: -1.3, hw: 0.66, bottom: 0.24, top: 0.68 },
      { x: -0.7, hw: 0.72, bottom: 0.22, top: 0.7 },
      { x: 0.6, hw: 0.72, bottom: 0.22, top: 0.66 },
      { x: 1.3, hw: 0.66, bottom: 0.24, top: 0.58 },
      { x: 1.33, hw: 0.05, bottom: 0.3, top: 0.5 },
    ],
    cabin: [
      { x: -0.8, hw: 0.05, bottom: 0.68, top: 0.7 },
      { x: -0.75, hw: 0.58, bottom: 0.68, top: 1.04 },
      { x: 0.2, hw: 0.6, bottom: 0.66, top: 1.08 },
      { x: 0.55, hw: 0.56, bottom: 0.64, top: 0.74 },
      { x: 0.6, hw: 0.05, bottom: 0.64, top: 0.66 },
    ],
    wheelX: [0.86, -0.84],
    wheelZ: 0.66,
    wheelRadius: 0.34,
    extras: [],
  },
  buggy: {
    label: "Dune buggy",
    shell: [
      { x: -1.1, hw: 0.05, bottom: 0.42, top: 0.56 },
      { x: -1.05, hw: 0.5, bottom: 0.36, top: 0.66 },
      { x: -0.2, hw: 0.56, bottom: 0.34, top: 0.62 },
      { x: 0.8, hw: 0.5, bottom: 0.36, top: 0.56 },
      { x: 1.2, hw: 0.4, bottom: 0.4, top: 0.48 },
      { x: 1.24, hw: 0.05, bottom: 0.42, top: 0.46 },
    ],
    cabin: [
      { x: -0.5, hw: 0.05, bottom: 0.62, top: 0.64 },
      { x: -0.45, hw: 0.4, bottom: 0.62, top: 0.8 },
      { x: 0.2, hw: 0.4, bottom: 0.6, top: 0.76 },
      { x: 0.25, hw: 0.05, bottom: 0.6, top: 0.62 },
    ],
    wheelX: [0.92, -0.9],
    wheelZ: 0.76,
    wheelRadius: 0.46,
    extras: ["rollcage"],
  },
};
