#!/usr/bin/env python3
"""Download the CC0 photo-scanned materials and HDRIs the client uses.

Source: Poly Haven (https://polyhaven.com), all assets CC0 (public domain).
Output: apps/client/public/assets/{pbr,env}/ plus CREDITS.md and a JSON
manifest the client reads (real-world size of every material, in cm).

Per material: albedo.webp (colour), detail.webp (greyscale albedo, tinted by
code), normal.webp (OpenGL), orm.webp (R=AO, G=roughness, B=metalness, the
layout Babylon's PBR metallicTexture expects), and detailmap.webp (Babylon
detail-map packing: R=albedo detail around 0.5, G=normal Y, B=roughness,
A=normal X) used as a fine second layer so surfaces hold up at toy-car
camera distance.
Per HDRI: a 512x256 Radiance .hdr for image-based lighting, and for outdoor
maps a 4096x2048 tonemapped sky photo for the background dome.
Per 3D model: a photo-scanned prop as one optimised .glb (quantised
geometry, WebP textures <= 1024 px) via gltf-transform, in models/.

Re-run any time; existing files are kept unless --force is given.
Needs: python3, Pillow, numpy, cwebp (brew install webp), npm install (gltf-transform).
"""
import io, json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "apps", "client", "public", "assets")
FORCE = "--force" in sys.argv
API = "https://api.polyhaven.com"
SIZE = 1024

# id -> Poly Haven asset. Grouped by use; see apps/client/src/render/materials.ts.
MATERIALS = {
    # floors
    "laminate": "laminate_floor_02",
    "carpet": "poly_wool_herringbone",
    "floor-tiles": "interior_tiles",
    "mosaic": "marble_tiles",
    "lawn": "leafy_grass",
    "garage-concrete": "garage_floor",
    "parquet": "herringbone_parquet",
    "sand": "sand_01",
    "dirt": "park_dirt",
    # walls
    "plaster": "painted_plaster_wall",
    "wall-tiles": "long_white_tiles",
    "block-wall": "concrete_block_wall",
    "panelling": "dark_paneled_wood",
    # furniture / props
    "wood": "kitchen_wood",
    "wood-fine": "fine_grained_wood",
    "oak": "grey_oak_veneer_01",
    "linen": "rough_linen",
    "velvet": "velour_velvet",
    "fleece": "knitted_fleece",
    "leather": "brown_leather",
    "bark": "bark_brown_02",
    "rock": "dry_riverbed_rock",
    "granite": "granite_tile",
}

# Photo-scanned props (Poly Haven ids); placed by apps/client/src/render/room/rooms.ts.
MODELS = [
    # living room
    "Sofa_01", "ArmChair_01", "CoffeeTable_01", "Ottoman_01", "Television_01", "side_table_01",
    "potted_plant_02", "potted_plant_04", "hanging_picture_frame_01", "throw_pillows_01",
    # kitchen
    "round_wooden_table_01", "dining_chair_02", "electric_stove", "vintage_microwave",
    "vintage_electric_kettle", "food_apple_01", "bananas", "lemon", "tea_set_01", "wooden_cutting_board",
    # playroom / kids' room / bedroom
    "rubber_duck_toy", "football", "american_football", "baseball_01", "gamepad", "Ukulele_01",
    "alarm_clock_01", "painted_wooden_cabinet", "painted_wooden_nightstand", "painted_wooden_chair_01",
    "SchoolDesk_01", "SchoolChair_01", "wooden_stool_01", "GreenChair_01", "vintage_cabinet_01",
    "desk_lamp_arm_01", "ornate_mirror_01",
    # bathroom
    "WetFloorSign_01", "bleach_bottle", "all_purpose_cleaner", "plunger", "wicker_basket_01",
    # workshop
    "metal_tool_chest", "steel_frame_shelves_01", "wooden_ladder", "Barrel_01", "Barrel_02", "old_tyre",
    "cardboard_box_01", "Drill_01", "bench_vice_01", "spray_paint_bottles", "metal_jerrycan",
    "portable_generator", "tire_pump", "wooden_crate_01",
    # library
    "book_encyclopedia_set_01", "Rockingchair_01", "vintage_grandfather_clock_01", "marble_bust_01",
    "vintage_oil_lamp", "mid_century_lounge_chair",
    # garden / sandbox
    "garden_gnome", "planter_box_01", "planter_pot_clay", "watering_can_metal_01", "wooden_picnic_table",
    "painted_wooden_bench", "tree_stump_01", "fern_02", "shrub_02", "stone_01", "lambis_shell",
    "wooden_bucket_01",
]

# theme -> (hdri id, outdoor background?)
HDRIS = {
    "toy-track": ("empty_play_room", False),
    "rug": ("lythwood_lounge", False),
    "kitchen": ("kiara_interior", False),
    "toy-canyon": ("small_empty_room_3", False),
    "bathroom": ("modern_bathroom", False),
    "garden": ("residential_garden", True),
    "bedroom": ("hotel_room", False),
    "workshop": ("garage", False),
    "library": ("reading_room", False),
    "sandbox": ("air_museum_playground", True),
}


def get(url):
    # curl uses the system trust store (python.org builds often ship without CA certs).
    return subprocess.run(["curl", "-sfL", "--retry", "3", "-A", "rc-combat-asset-fetch", url], check=True, capture_output=True).stdout


def api(path):
    return json.loads(get(f"{API}/{path}"))


def webp(img, path, quality=82):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name)
        subprocess.run(["cwebp", "-quiet", "-q", str(quality), "-m", "6", f.name, "-o", path], check=True)
    os.unlink(f.name)


def load(files, key):
    if key not in files:
        return None
    return Image.open(io.BytesIO(get(files[key]["1k"]["jpg"]["url"])))


def fetch_material(mid, ph, manifest):
    out = os.path.join(ROOT, "pbr", mid)
    os.makedirs(out, exist_ok=True)
    info = api(f"info/{ph}")
    dims = info.get("dimensions") or [1000, 1000]  # mm
    manifest[mid] = {"source": ph, "name": info["name"], "sizeCm": [round(dims[0] / 10, 1), round(dims[1] / 10, 1)]}
    if not FORCE and os.path.exists(os.path.join(out, "orm.webp")):
        return
    files = api(f"files/{ph}")
    diff = load(files, "Diffuse").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    webp(diff, os.path.join(out, "albedo.webp"))
    # Greyscale detail normalised to mean 0.78 so a tint colour reads true.
    g = np.asarray(diff.convert("L"), dtype=np.float32) / 255.0
    g = np.clip(g * (0.78 / max(g.mean(), 1e-3)), 0, 1)
    webp(Image.fromarray((g * 255).astype(np.uint8)).convert("RGB"), os.path.join(out, "detail.webp"))
    webp(load(files, "nor_gl").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS), os.path.join(out, "normal.webp"), 88)
    rough = load(files, "Rough").convert("L").resize((SIZE, SIZE), Image.LANCZOS)
    ao_img = load(files, "AO")
    ao = ao_img.convert("L").resize((SIZE, SIZE), Image.LANCZOS) if ao_img else Image.new("L", (SIZE, SIZE), 255)
    metal_img = load(files, "Metal")
    metal = metal_img.convert("L").resize((SIZE, SIZE), Image.LANCZOS) if metal_img else Image.new("L", (SIZE, SIZE), 0)
    webp(Image.merge("RGB", (ao, rough, metal)), os.path.join(out, "orm.webp"))


def build_detailmap(out):
    """Pack Babylon's detail map from the already exported maps (512 px, it tiles many times)."""
    path = os.path.join(out, "detailmap.webp")
    if not FORCE and os.path.exists(path):
        return
    size = (512, 512)
    lum = np.asarray(Image.open(os.path.join(out, "albedo.webp")).convert("L").resize(size, Image.LANCZOS), dtype=np.float32)
    lum = np.clip(128 + (lum - lum.mean()) * 1.4, 0, 255)
    nrm = Image.open(os.path.join(out, "normal.webp")).convert("RGB").resize(size, Image.LANCZOS)
    rough = Image.open(os.path.join(out, "orm.webp")).convert("RGB").resize(size, Image.LANCZOS).split()[1]
    nr, ng, _ = nrm.split()
    img = Image.merge("RGBA", (Image.fromarray(lum.astype(np.uint8)), ng, rough, nr))
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name)
        subprocess.run(["cwebp", "-quiet", "-q", "85", "-exact", "-alpha_q", "100", f.name, "-o", path], check=True)
    os.unlink(f.name)


def read_hdr(data):
    """Minimal Radiance RGBE reader (new-style RLE and flat)."""
    i = 0
    while True:
        j = data.index(b"\n", i)
        line = data[i:j]
        i = j + 1
        if line.startswith(b"-Y") or line.startswith(b"+Y"):
            parts = line.split()
            h, w = int(parts[1]), int(parts[3])
            break
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        if data[i] == 2 and data[i + 1] == 2:
            i += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[i]; i += 1
                    if n > 128:
                        n -= 128
                        out[y, x:x + n, c] = data[i]; i += 1
                    else:
                        out[y, x:x + n, c] = np.frombuffer(data[i:i + n], np.uint8); i += n
                    x += n
        else:
            out[y] = np.frombuffer(data[i:i + w * 4], np.uint8).reshape(w, 4); i += w * 4
    rgbe = out.astype(np.float32)
    scale = np.where(out[..., 3] > 0, np.ldexp(1.0, out[..., 3].astype(np.int32) - 136), 0)
    return rgbe[..., :3] * scale[..., None]


def write_hdr(rgb, path):
    h, w, _ = rgb.shape
    m = rgb.max(axis=2)
    e = np.zeros_like(m, dtype=np.int32)
    mant, e = np.frexp(m)
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(m > 1e-32, mant * 256.0 / m, 0)
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(rgb * s[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + f"-Y {h} +X {w}\n".encode())
        f.write(rgbe.tobytes())


def fetch_hdri(theme, ph, outdoor, manifest):
    out = os.path.join(ROOT, "env")
    os.makedirs(out, exist_ok=True)
    info = api(f"info/{ph}")
    manifest[theme] = {"source": ph, "name": info["name"], "sky": outdoor}
    hdr_path = os.path.join(out, f"{theme}.hdr")
    files = None
    if FORCE or not os.path.exists(hdr_path):
        files = api(f"files/{ph}")
        rgb = read_hdr(get(files["hdri"]["1k"]["hdr"]["url"]))
        h, w, _ = rgb.shape
        small = rgb.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
        write_hdr(small.astype(np.float32), hdr_path)
    sky_path = os.path.join(out, f"{theme}-sky.webp")
    if outdoor and (FORCE or not os.path.exists(sky_path)):
        files = files or api(f"files/{ph}")
        Image.MAX_IMAGE_PIXELS = None
        img = Image.open(io.BytesIO(get(files["tonemapped"]["url"]))).convert("RGB").resize((4096, 2048), Image.LANCZOS)
        webp(img, sky_path, 80)


def fetch_model(ph, manifest):
    out = os.path.join(ROOT, "models")
    os.makedirs(out, exist_ok=True)
    info = api(f"info/{ph}")
    manifest[ph] = {"name": info["name"], "tris": info.get("polycount")}
    glb = os.path.join(out, f"{ph}.glb")
    if not FORCE and os.path.exists(glb):
        return
    files = api(f"files/{ph}")["gltf"]["1k"]["gltf"]
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, f"{ph}.gltf")
        with open(src, "wb") as f:
            f.write(get(files["url"]))
        for rel, inc in files.get("include", {}).items():
            path = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(get(inc["url"]))
        cli = os.path.join(os.path.dirname(__file__), "..", "node_modules", ".bin", "gltf-transform")
        subprocess.run([cli, "optimize", src, glb, "--compress", "quantize", "--texture-compress", "webp",
                        "--texture-size", "1024", "--palette", "false", "--simplify-error", "0.0005"],
                       check=True, capture_output=True)


def main():
    manifest = {"materials": {}, "environments": {}, "models": {}}
    for mid, ph in MATERIALS.items():
        print("material", mid, ph, flush=True)
        fetch_material(mid, ph, manifest["materials"])
        build_detailmap(os.path.join(ROOT, "pbr", mid))
    for theme, (ph, outdoor) in HDRIS.items():
        print("hdri", theme, ph, flush=True)
        fetch_hdri(theme, ph, outdoor, manifest["environments"])
    for ph in MODELS:
        print("model", ph, flush=True)
        fetch_model(ph, manifest["models"])
    with open(os.path.join(ROOT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    lines = ["# Third-party assets", "", "All files under `pbr/`, `env/` and `models/` come from [Poly Haven](https://polyhaven.com) and are **CC0** (public domain). Thank you to the Poly Haven artists and photographers.", ""]
    lines += [f"- `pbr/{k}/` — {v['name']} (`{v['source']}`), https://polyhaven.com/a/{v['source']}" for k, v in manifest["materials"].items()]
    lines += [f"- `models/{k}.glb` — {v['name']}, https://polyhaven.com/a/{k}" for k, v in manifest["models"].items()]
    lines += [f"- `env/{k}.hdr` — {v['name']} (`{v['source']}`), https://polyhaven.com/a/{v['source']}" for k, v in manifest["environments"].items()]
    with open(os.path.join(ROOT, "CREDITS.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
