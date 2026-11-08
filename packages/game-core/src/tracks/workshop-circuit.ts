import type { TrackDefinition } from "../track.js";

/**
 * Toy Track Classic: orange plastic toy-track pieces laid out on a wooden
 * floor. Flat and fast: long start straight, sweeping right-hander, tight
 * pocket, chicane and a quick back curve. About 1.1 km per lap.
 * (Id kept as "workshop-circuit" so older replays still resolve.)
 */
export const WORKSHOP_CIRCUIT: TrackDefinition = {
  id: "workshop-circuit",
  name: "Toy Track Classic",
  theme: "toy-track",
  width: 16,
  checkpointCount: 16,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0],
    [120, 0],
    [230, 6],
    [292, 48],
    [304, 122],
    [268, 186],
    [204, 204],
    [160, 166],
    [110, 152],
    [70, 200],
    [10, 216],
    [-62, 192],
    [-104, 130],
    [-98, 60],
    [-62, 14],
  ],
  itemRows: [
    { at: 0.1, count: 4 },
    { at: 0.36, count: 4 },
    { at: 0.6, count: 4 },
    { at: 0.85, count: 4 },
  ],
  ramps: [{ at: 0.52 }],
};

/**
 * Living Room Rug: around and over a big patterned rug. Cushions pushed under
 * the rug make rolling hills; a hardback book is a jump ramp. No water.
 */
export const LIVING_ROOM_RUG: TrackDefinition = {
  id: "living-room-rug",
  name: "Living Room Rug",
  theme: "rug",
  width: 16,
  checkpointCount: 16,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0, 0],
    [110, -10, 0],
    [200, 10, 2.5],
    [250, 70, 5],
    [240, 150, 3.5],
    [180, 196, 0.5],
    [110, 178, 0],
    [56, 126, 2.5],
    [0, 138, 4],
    [-70, 176, 1.5],
    [-142, 142, 0],
    [-162, 62, 0],
    [-110, 12, 0],
  ],
  itemRows: [
    { at: 0.12, count: 4 },
    { at: 0.38, count: 4 },
    { at: 0.62, count: 4 },
    { at: 0.87, count: 4 },
  ],
  ramps: [{ at: 0.3 }, { at: 0.74 }],
};

/**
 * Kitchen Tiles: ceramic floor between table legs and the fridge. Two water
 * spills (slippery, slow), a raised serving tray section and cutting-board
 * ramps.
 */
export const KITCHEN_TILES: TrackDefinition = {
  id: "kitchen-tiles",
  name: "Kitchen Tiles",
  theme: "kitchen",
  width: 16,
  checkpointCount: 16,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0, 0],
    [140, 0, 0],
    [230, -10, 0],
    [280, 50, 0],
    [262, 130, 1.5],
    [192, 162, 1.5],
    [130, 152, 0.5],
    [80, 192, 0],
    [100, 262, 0],
    [30, 302, 0],
    [-60, 272, 0],
    [-102, 192, 0],
    [-62, 122, 0],
    [-112, 62, 0],
    [-72, 12, 0],
  ],

  itemRows: [
    { at: 0.1, count: 4 },
    { at: 0.34, count: 4 },
    { at: 0.58, count: 4 },
    { at: 0.84, count: 4 },
  ],
  laps: 4,
  water: [
    { from: 0.17, to: 0.23 },
    { from: 0.63, to: 0.69 },
  ],
  ramps: [{ at: 0.07 }, { at: 0.48 }],
};

/**
 * Toy Track Canyon: blue plastic track on stands that climbs to 12 m over a
 * pile of toy boxes, plunges down, and splashes through a shallow tray of
 * water at the bottom.
 */
export const TOY_TRACK_CANYON: TrackDefinition = {
  id: "toy-track-canyon",
  name: "Toy Track Canyon",
  theme: "toy-canyon",
  width: 16,
  checkpointCount: 18,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0, 0],
    [120, 0, 3],
    [220, 30, 8],
    [272, 100, 12],
    [232, 172, 11],
    [152, 172, 8],
    [106, 226, 5],
    [170, 284, 6],
    [86, 348, 3],
    [-12, 304, 0],
    [-62, 232, 0],
    [-30, 160, 2],
    [-92, 100, 1],
    [-72, 30, 0],
  ],
  itemRows: [
    { at: 0.1, count: 4 },
    { at: 0.35, count: 4 },
    { at: 0.6, count: 4 },
    { at: 0.85, count: 4 },
  ],
  laps: 4,
  water: [{ from: 0.68, to: 0.75 }],
  ramps: [{ at: 0.44 }, { at: 0.9 }],
};

export const TRACKS: Record<string, TrackDefinition> = {
  [WORKSHOP_CIRCUIT.id]: WORKSHOP_CIRCUIT,
  [LIVING_ROOM_RUG.id]: LIVING_ROOM_RUG,
  [KITCHEN_TILES.id]: KITCHEN_TILES,
  [TOY_TRACK_CANYON.id]: TOY_TRACK_CANYON,
};

export const TRACK_IDS = Object.keys(TRACKS);
