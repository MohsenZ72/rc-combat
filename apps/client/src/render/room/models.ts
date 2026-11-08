import { LoadAssetContainerAsync, type AssetContainer, type Scene } from "@babylonjs/core";

/**
 * Photo-scanned CC0 props from Poly Haven (fetched and optimised by
 * scripts/fetch-assets.py into public/assets/models). Each .glb loads once
 * per scene into an AssetContainer; every placement instantiates it, so ten
 * apples cost one download and share GPU buffers.
 */
export type ModelId =
  | "Sofa_01" | "ArmChair_01" | "CoffeeTable_01" | "Ottoman_01" | "Television_01" | "side_table_01"
  | "potted_plant_02" | "potted_plant_04" | "hanging_picture_frame_01" | "throw_pillows_01"
  | "round_wooden_table_01" | "dining_chair_02" | "electric_stove" | "vintage_microwave"
  | "vintage_electric_kettle" | "food_apple_01" | "bananas" | "lemon" | "tea_set_01" | "wooden_cutting_board"
  | "rubber_duck_toy" | "football" | "american_football" | "baseball_01" | "gamepad" | "Ukulele_01"
  | "alarm_clock_01" | "painted_wooden_cabinet" | "painted_wooden_nightstand" | "painted_wooden_chair_01"
  | "SchoolDesk_01" | "SchoolChair_01" | "wooden_stool_01" | "GreenChair_01" | "vintage_cabinet_01"
  | "desk_lamp_arm_01" | "ornate_mirror_01"
  | "WetFloorSign_01" | "bleach_bottle" | "all_purpose_cleaner" | "plunger" | "wicker_basket_01"
  | "metal_tool_chest" | "steel_frame_shelves_01" | "wooden_ladder" | "Barrel_01" | "Barrel_02" | "old_tyre"
  | "cardboard_box_01" | "Drill_01" | "bench_vice_01" | "spray_paint_bottles" | "metal_jerrycan"
  | "portable_generator" | "tire_pump" | "wooden_crate_01"
  | "book_encyclopedia_set_01" | "Rockingchair_01" | "vintage_grandfather_clock_01" | "marble_bust_01"
  | "vintage_oil_lamp" | "mid_century_lounge_chair"
  | "garden_gnome" | "planter_box_01" | "planter_pot_clay" | "watering_can_metal_01" | "wooden_picnic_table"
  | "painted_wooden_bench" | "tree_stump_01" | "fern_02" | "shrub_02" | "stone_01" | "lambis_shell"
  | "wooden_bucket_01";

const MODEL_BASE = `${import.meta.env.BASE_URL}assets/models`;
/** The glTF loader is its own chunk, fetched the first time a room needs a model. */
let gltfLoader: Promise<unknown> | null = null;
const cache = new WeakMap<Scene, Map<ModelId, Promise<AssetContainer | null>>>();

/** Loads (once per scene) the container for a model; resolves null if the file is missing. */
export function loadModel(scene: Scene, id: ModelId): Promise<AssetContainer | null> {
  let byId = cache.get(scene);
  if (!byId) {
    byId = new Map();
    cache.set(scene, byId);
  }
  let p = byId.get(id);
  if (!p) {
    gltfLoader ??= import("@babylonjs/loaders/glTF/2.0");
    p = gltfLoader.then(() => LoadAssetContainerAsync(`${MODEL_BASE}/${id}.glb`, scene)).catch((err: unknown) => {
      console.warn(`model ${id} failed to load`, err);
      return null;
    });
    byId.set(id, p);
  }
  return p;
}
