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

const rows = (...at: number[]) => at.map((a) => ({ at: a, count: 4 }));

/** Bathroom Splash: mosaic tiles round the bathtub; overflowing tub puddles, bath-mat bumps. */
export const BATHROOM_SPLASH: TrackDefinition = {
  id: "bathroom-splash",
  name: "Bathroom Splash",
  theme: "bathroom",
  width: 16,
  checkpointCount: 16,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0, 0], [130, -5, 0], [222, 25, 0], [252, 95, 1], [208, 162, 2], [122, 172, 1], [72, 232, 0],
    [-10, 252, 0], [-92, 212, 0], [-120, 140, 0], [-70, 92, 1], [-92, 36, 0], [-56, -6, 0],
  ],
  itemRows: rows(0.1, 0.35, 0.6, 0.85),
  water: [{ from: 0.2, to: 0.26 }, { from: 0.55, to: 0.61 }],
  ramps: [{ at: 0.42 }],
};

/** Garden Path: a dirt path through the lawn, over grassy mounds, past puddles and flower beds. */
export const GARDEN_PATH: TrackDefinition = {
  id: "garden-path",
  name: "Garden Path",
  theme: "garden",
  width: 16,
  checkpointCount: 18,
  sampleSpacing: 3,
  laps: 4,
  controlPoints: [
    [0, 0, 0], [140, 0, 1], [250, -20, 3], [322, 40, 6], [312, 130, 8], [242, 182, 5], [152, 162, 2],
    [92, 212, 0], [122, 292, 2], [42, 332, 4], [-60, 302, 3], [-112, 222, 1], [-82, 142, 0], [-142, 82, 0], [-100, 15, 0],
  ],
  itemRows: rows(0.1, 0.33, 0.58, 0.83),
  water: [{ from: 0.47, to: 0.52 }, { from: 0.76, to: 0.8 }],
  ramps: [{ at: 0.22 }, { at: 0.66 }],
};

/** Bedroom Dash: a tight, technical lap over the carpet, across the duvet and off book ramps. */
export const BEDROOM_DASH: TrackDefinition = {
  id: "bedroom-dash",
  name: "Bedroom Dash",
  theme: "bedroom",
  width: 16,
  checkpointCount: 16,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0, 0], [122, 0, 0], [196, 40, 0], [188, 112, 2], [112, 134, 4], [72, 196, 3], [128, 228, 2],
    [152, 274, 1], [104, 316, 0], [36, 314, 0], [-32, 280, 0], [-64, 196, 0], [-22, 124, 0], [-84, 72, 0], [-62, 14, 0],
  ],
  itemRows: rows(0.12, 0.37, 0.62, 0.86),
  ramps: [{ at: 0.3 }, { at: 0.7 }],
};

/** Garage Workshop: concrete floor under the workbench; oil slicks, a plank ramp and a raised pallet. */
export const GARAGE_WORKSHOP: TrackDefinition = {
  id: "garage-workshop",
  name: "Garage Workshop",
  theme: "workshop",
  width: 16,
  checkpointCount: 16,
  sampleSpacing: 3,
  controlPoints: [
    [0, 0, 0], [160, 0, 0], [262, 12, 0], [304, 82, 0], [264, 152, 2], [172, 154, 3], [112, 112, 3],
    [42, 142, 1], [12, 214, 0], [-72, 224, 0], [-124, 152, 0], [-92, 72, 0], [-62, 12, 0],
  ],
  itemRows: rows(0.1, 0.36, 0.6, 0.85),
  water: [{ from: 0.3, to: 0.35 }, { from: 0.8, to: 0.85 }],
  ramps: [{ at: 0.18 }, { at: 0.56 }],
};

/** Library Loop: climb stacks of books to the reading desk and dive back to the parquet. */
export const LIBRARY_LOOP: TrackDefinition = {
  id: "library-loop",
  name: "Library Loop",
  theme: "library",
  width: 16,
  checkpointCount: 18,
  sampleSpacing: 3,
  laps: 5,
  controlPoints: [
    [0, 0, 0], [132, 0, 2], [222, 30, 5], [262, 102, 8], [232, 182, 10], [152, 212, 8], [82, 182, 5],
    [22, 232, 3], [-60, 252, 2], [-132, 202, 1], [-142, 122, 0], [-92, 62, 0], [-70, 10, 0],
  ],
  itemRows: rows(0.1, 0.35, 0.6, 0.85),
  ramps: [{ at: 0.52 }, { at: 0.86 }],
};

/** Sandbox Dunes: playground sand dunes, a splash through the paddling pool, bucket-and-spade ramps. */
export const SANDBOX_DUNES: TrackDefinition = {
  id: "sandbox-dunes",
  name: "Sandbox Dunes",
  theme: "sandbox",
  width: 16,
  checkpointCount: 18,
  sampleSpacing: 3,
  laps: 4,
  controlPoints: [
    [0, 0, 0], [132, -10, 1], [232, 10, 3], [282, 80, 5], [252, 162, 6], [172, 202, 3], [92, 172, 1],
    [52, 216, 0], [70, 268, 1], [56, 322, 2], [-10, 346, 3], [-70, 318, 4], [-102, 282, 2], [-132, 192, 0], [-82, 122, 0], [-132, 62, 0], [-82, 10, 0],
  ],
  itemRows: rows(0.1, 0.34, 0.6, 0.84),
  water: [{ from: 0.5, to: 0.56 }],
  ramps: [{ at: 0.2 }, { at: 0.74 }],
};

export const TRACKS: Record<string, TrackDefinition> = Object.fromEntries(
  [WORKSHOP_CIRCUIT, LIVING_ROOM_RUG, KITCHEN_TILES, TOY_TRACK_CANYON, BATHROOM_SPLASH, GARDEN_PATH, BEDROOM_DASH, GARAGE_WORKSHOP, LIBRARY_LOOP, SANDBOX_DUNES].map(
    (t) => [t.id, t],
  ),
);

export const TRACK_IDS = Object.keys(TRACKS);
