export * from "./config.js";
export * from "./protocol.js";
export * from "./events.js";
export * from "./types.js";

/** Car paint colours by slot. Purely cosmetic; identical stats for every car. */
export const SLOT_COLORS = [
  "#ff5a36",
  "#2f9bff",
  "#ffc933",
  "#3ddc84",
  "#c45bff",
  "#ff6fb5",
  "#26d7d7",
  "#f2f2f2",
  "#ff9f1c",
  "#8a8dff",
] as const;
export * from "./cosmetics.js";
