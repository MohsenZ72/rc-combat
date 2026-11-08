import type { TrackDefinition } from "../track.js";

/**
 * "Workshop Circuit" — an RC track taped out on the floor of a giant garage.
 * Long start straight, a sweeping right-hander, a tight hairpin pocket, a
 * chicane past the workbench and a fast back curve home. ~1.1 km per lap.
 */
export const WORKSHOP_CIRCUIT: TrackDefinition = {
  id: "workshop-circuit",
  name: "Workshop Circuit",
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
};

export const TRACKS: Record<string, TrackDefinition> = {
  [WORKSHOP_CIRCUIT.id]: WORKSHOP_CIRCUIT,
};
