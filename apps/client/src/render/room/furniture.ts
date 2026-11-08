import type { TransformNode } from "@babylonjs/core";
import type { Kit } from "./kit.js";

/**
 * Household furniture and objects, modelled from primitives in real
 * centimetres and scaled to the toy world: the cars are small (about 3.6 cm)
 * diecast toys simulated as 2.6 m, so 1 cm of furniture ≈ 0.72 game metres
 * and the room towers over the race.
 * Every builder works in a local frame: x along the wall, y up, z = depth
 * (positive z points away from the wall into the room).
 */
export const CM = 0.72;
const c = (v: number) => v * CM;

type G = TransformNode;

// ------------------------------------------------------------------ kitchen

export function counterRun(k: Kit, g: G, widthCm: number, opts: { sink?: boolean; dishwasherAt?: number; doorColor?: string; top?: string } = {}): void {
  const door = k.mat(opts.doorColor ?? "#f4f1ea", { spec: 0.3 });
  const top = k.mat(opts.top ?? "#3b3f45", { surface: "granite", rough: 0.35 });
  const handle = k.mat("#c9cdd3", { spec: 1, power: 96 });
  const plinth = k.mat("#2a2d31");
  const w = c(widthCm);
  k.box(g, [w, c(10), c(55)], [0, c(5), c(28)], plinth);
  k.box(g, [w, c(76), c(58)], [0, c(48), c(30)], door);
  k.box(g, [w + c(2), c(4), c(62)], [0, c(88), c(31)], top);
  const units = Math.max(1, Math.round(widthCm / 60));
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + (w / units) * (i + 0.5);
    if (opts.dishwasherAt === i) continue;
    k.box(g, [w / units - c(1), c(1), c(1)], [x, c(70), c(59.5)], k.mat("#d8d3c8"));
    k.box(g, [c(18), c(2), c(2)], [x, c(74), c(60.5)], handle);
    k.box(g, [c(1), c(56), c(1)], [x - w / units / 2, c(40), c(59.5)], k.mat("#d8d3c8"));
  }
  if (opts.dishwasherAt !== undefined) dishwasherFront(k, g, -w / 2 + (w / units) * (opts.dishwasherAt + 0.5));
  if (opts.sink) sink(k, g, 0);
}

function dishwasherFront(k: Kit, g: G, x: number): void {
  const steel = k.mat("#b9bec5", { spec: 1, power: 128 });
  k.box(g, [c(59), c(72), c(2)], [x, c(46), c(60)], steel);
  k.box(g, [c(59), c(8), c(3)], [x, c(82), c(60)], k.mat("#22252a", { spec: 0.6 }));
  k.box(g, [c(40), c(2.5), c(3)], [x, c(76), c(62)], k.mat("#d9dde2", { spec: 1, power: 128 }));
  for (let i = 0; i < 4; i++) k.sphere(g, c(1.6), [x + c(-18 + i * 6), c(82), c(61.6)], k.mat(i === 0 ? "#3ddc84" : "#9fb3c8", { emissive: 0.8 }));
}

function sink(k: Kit, g: G, x: number): void {
  const steel = k.mat("#c8cdd3", { spec: 1, power: 128 });
  const water = k.mat("#9fd8ff", { alpha: 0.5, spec: 1, power: 128 });
  k.box(g, [c(56), c(1), c(42)], [x, c(90.5), c(30)], steel);
  k.box(g, [c(48), c(1), c(34)], [x, c(84), c(30)], k.mat("#7d838b", { spec: 0.8 }));
  k.box(g, [c(46), c(0.5), c(32)], [x, c(86), c(30)], water);
  k.cyl(g, c(3), c(28), [x, c(104), c(8)], steel);
  k.cyl(g, c(2.4), c(22), [x, c(118), c(18)], steel, { rot: [Math.PI / 2, 0, 0] });
  k.cyl(g, c(2), c(4), [x, c(115), c(28)], steel);
  k.box(g, [c(3), c(1.5), c(10)], [x + c(6), c(110), c(8)], steel);
}

export function upperCabinets(k: Kit, g: G, widthCm: number, color = "#f4f1ea"): void {
  const door = k.mat(color, { spec: 0.3 });
  const handle = k.mat("#c9cdd3", { spec: 1, power: 96 });
  const w = c(widthCm);
  k.box(g, [w, c(70), c(35)], [0, c(180), c(17.5)], door);
  const units = Math.max(1, Math.round(widthCm / 50));
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + (w / units) * (i + 0.5);
    k.box(g, [c(1), c(66), c(1)], [x - w / units / 2, c(180), c(35.5)], k.mat("#d8d3c8"));
    k.box(g, [c(2), c(14), c(2)], [x + w / units / 2 - c(6), c(158), c(36.5)], handle);
  }
}

export function fridge(k: Kit, g: G): void {
  const body = k.mat("#e9edf2", { spec: 0.9, power: 96 });
  const handle = k.mat("#aeb4bc", { spec: 1, power: 128 });
  k.box(g, [c(70), c(180), c(66)], [0, c(90), c(33)], body);
  k.box(g, [c(70), c(1), c(1)], [0, c(118), c(66.5)], k.mat("#c5ccd4"));
  k.box(g, [c(3), c(50), c(4)], [c(30), c(150), c(68)], handle);
  k.box(g, [c(3), c(60), c(4)], [c(30), c(80), c(68)], handle);
  k.box(g, [c(16), c(24), c(1)], [c(-14), c(140), c(66.6)], k.mat("#2a2f36", { spec: 0.6 }));
  const magnets = ["#e2413b", "#ffc933", "#2f7de1", "#3ddc84", "#ff6fb5"];
  magnets.forEach((m, i) => k.box(g, [c(5), c(5), c(1)], [c(-20 + i * 9), c(100 - (i % 2) * 8), c(66.8)], k.mat(m)));
  k.box(g, [c(20), c(28), c(0.6)], [c(5), c(70), c(66.9)], k.mat("#fff7d6"));
}

export function stove(k: Kit, g: G): void {
  const steel = k.mat("#c8cdd3", { spec: 1, power: 96 });
  const black = k.mat("#1c1e22", { spec: 0.6, power: 64 });
  k.box(g, [c(60), c(88), c(60)], [0, c(44), c(30)], steel);
  k.box(g, [c(60), c(2), c(60)], [0, c(89), c(30)], black);
  for (const [x, z] of [[-15, 15], [15, 15], [-15, 42], [15, 42]] as const) {
    k.cyl(g, c(16), c(1), [c(x), c(90.5), c(z)], k.mat("#2b2e33", { spec: 0.4 }));
    k.torus(g, c(12), c(1.2), [c(x), c(91), c(z)], k.mat("#4a4f57"));
  }
  k.box(g, [c(50), c(36), c(1)], [0, c(38), c(60.6)], k.mat("#10131a", { spec: 1, power: 128, alpha: 0.85 }));
  k.box(g, [c(46), c(2.5), c(3)], [0, c(62), c(63)], steel);
  for (let i = 0; i < 4; i++) k.cyl(g, c(4), c(2.5), [c(-21 + i * 14), c(78), c(61.5)], black, { rot: [Math.PI / 2, 0, 0] });
}

export function rangeHood(k: Kit, g: G): void {
  const steel = k.mat("#c8cdd3", { spec: 1, power: 96 });
  k.box(g, [c(60), c(12), c(48)], [0, c(156), c(24)], steel);
  k.cyl(g, c(30), c(60), [0, c(196), c(18)], steel, { top: c(24), tess: 4, rot: [0, Math.PI / 4, 0] });
  k.box(g, [c(40), c(1), c(30)], [0, c(150), c(26)], k.mat("#fff4c2", { emissive: 0.8 }));
}

export function washingMachine(k: Kit, g: G, dryer = false): void {
  const body = k.mat("#f3f5f7", { spec: 0.7, power: 64 });
  const chrome = k.mat("#d9dde2", { spec: 1, power: 128 });
  k.box(g, [c(60), c(85), c(60)], [0, c(42.5), c(30)], body);
  k.box(g, [c(60), c(12), c(1)], [0, c(78), c(60.5)], k.mat("#e3e7eb", { spec: 0.6 }));
  k.box(g, [c(18), c(6), c(1)], [c(-16), c(78), c(61)], k.mat("#d8dce0"));
  k.cyl(g, c(7), c(3), [c(16), c(78), c(61.5)], chrome, { rot: [Math.PI / 2, 0, 0] });
  k.box(g, [c(10), c(4), c(1)], [c(1), c(78), c(61)], k.mat("#0f2a3a", { emissive: 0.6 }));
  k.torus(g, c(36), c(4), [0, c(38), c(61)], chrome, [Math.PI / 2, 0, 0]);
  k.cyl(g, c(32), c(1), [0, c(38), c(61.5)], k.mat("#5d6f82", { alpha: 0.45, spec: 1, power: 128 }), { rot: [Math.PI / 2, 0, 0] });
  k.cyl(g, c(30), c(2), [0, c(38), c(55)], k.mat("#7a828c", { spec: 0.8 }), { rot: [Math.PI / 2, 0, 0] });
  if (!dryer) {
    // Laundry tumbling inside the drum.
    k.sphere(g, c(12), [c(-5), c(32), c(56)], k.mat("#2f7de1"), [1, 0.6, 0.8]);
    k.sphere(g, c(10), [c(6), c(30), c(56)], k.mat("#e2413b"), [1, 0.6, 0.8]);
  }
  k.box(g, [c(56), c(4), c(56)], [0, c(1), c(30)], k.mat("#c9ced4"));
}

export function microwave(k: Kit, g: G, y: number): void {
  k.box(g, [c(48), c(28), c(36)], [0, y + c(14), c(22)], k.mat("#2a2d31", { spec: 0.6 }));
  k.box(g, [c(32), c(20), c(1)], [c(-6), y + c(14), c(40.5)], k.mat("#11161c", { spec: 1, alpha: 0.85 }));
  k.box(g, [c(8), c(18), c(1)], [c(18), y + c(14), c(40.5)], k.mat("#3a3e44"));
}

export function kettle(k: Kit, g: G, x: number, y: number, z: number, color = "#e2413b"): void {
  k.cyl(g, c(16), c(22), [x, y + c(11), z], k.mat(color, { spec: 0.8, power: 64 }), { top: c(12) });
  k.torus(g, c(10), c(2), [x - c(9), y + c(14), z], k.mat("#1c1e22"), [0, 0, Math.PI / 2]);
  k.cyl(g, c(10), c(2), [x, y + c(1), z], k.mat("#1c1e22"));
}

export function toaster(k: Kit, g: G, x: number, y: number, z: number): void {
  k.box(g, [c(28), c(18), c(16)], [x, y + c(9), z], k.mat("#c8cdd3", { spec: 1, power: 96 }));
  k.box(g, [c(20), c(1), c(3)], [x, y + c(18.5), z - c(3)], k.mat("#1c1e22"));
  k.box(g, [c(20), c(1), c(3)], [x, y + c(18.5), z + c(3)], k.mat("#1c1e22"));
}

export function fruitBowl(k: Kit, g: G, x: number, y: number, z: number): void {
  k.cyl(g, c(30), c(8), [x, y + c(4), z], k.mat("#f2f2f2", { spec: 0.7 }), { top: c(34) });
  const fruits: [string, number, number][] = [["#d7263d", -6, 0], ["#7ac74f", 6, 3], ["#ff9f1c", 0, -6], ["#ffd21a", 2, 7]];
  for (const [col, dx, dz] of fruits) k.sphere(g, c(9), [x + c(dx), y + c(11), z + c(dz)], k.mat(col, { spec: 0.6 }));
}

export function table(k: Kit, g: G, wCm = 120, dCm = 80, color = "#b07a4a"): void {
  const wood = k.mat(color, { spec: 0.25 });
  k.box(g, [c(wCm), c(4), c(dCm)], [0, c(73), 0], wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(g, [c(5), c(71), c(5)], [sx * c(wCm / 2 - 6), c(35.5), sz * c(dCm / 2 - 6)], wood);
}

export function chair(k: Kit, g: G, color = "#7a4a2a"): void {
  const wood = k.mat(color, { spec: 0.25 });
  k.box(g, [c(42), c(4), c(42)], [0, c(45), 0], wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(g, [c(4), c(45), c(4)], [sx * c(18), c(22.5), sz * c(18)], wood);
  k.box(g, [c(42), c(40), c(3)], [0, c(68), c(-19)], wood);
}

export function trashBin(k: Kit, g: G): void {
  k.cyl(g, c(30), c(60), [0, c(30), c(20)], k.mat("#aeb4bc", { spec: 1, power: 96 }));
  k.cyl(g, c(31), c(4), [0, c(62), c(20)], k.mat("#2a2d31"));
}

export function petBowl(k: Kit, g: G, x: number, z: number): void {
  k.cyl(g, c(22), c(7), [x, c(3.5), z], k.mat("#2f7de1", { spec: 0.6 }), { top: c(18) });
  k.cyl(g, c(17), c(1), [x, c(6.5), z], k.mat("#9fd8ff", { alpha: 0.6, spec: 1 }));
}

// ------------------------------------------------------------------ living room / bedroom

export function sofa(k: Kit, g: G, color = "#5b6b8c", widthCm = 210): void {
  const fabric = k.mat(color, { surface: "velvet" });
  const w = c(widthCm);
  k.box(g, [w, c(40), c(90)], [0, c(22), c(45)], fabric);
  k.box(g, [w, c(50), c(20)], [0, c(62), c(10)], fabric);
  for (const s of [-1, 1]) k.box(g, [c(20), c(60), c(90)], [s * (w / 2 - c(10)), c(32), c(45)], fabric);
  const cushions = Math.round(widthCm / 70);
  for (let i = 0; i < cushions; i++) {
    const x = -w / 2 + c(20) + ((w - c(40)) / cushions) * (i + 0.5);
    k.box(g, [(w - c(40)) / cushions - c(2), c(14), c(66)], [x, c(49), c(52)], k.mat(color, { surface: "velvet" }));
  }
  k.sphere(g, c(40), [-w / 2 + c(45), c(70), c(28)], k.mat("#d9a93a", { surface: "linen" }), [1, 1, 0.4]);
  for (const s of [-1, 1]) for (const z of [12, 80]) k.cyl(g, c(5), c(8), [s * (w / 2 - c(12)), c(1), c(z)], k.mat("#2a1e14"));
}

export function armchair(k: Kit, g: G, color = "#8c5b5b"): void {
  sofa(k, g, color, 95);
}

export function coffeeTable(k: Kit, g: G): void {
  table(k, g, 100, 60, "#8a5a36");
  g.getChildMeshes().forEach((m) => {
    if (m.position.y > c(60)) m.position.y = c(42);
  });
  const mug = k.mat("#f2f2f2", { spec: 0.6 });
  k.cyl(g, c(9), c(10), [c(-20), c(78), c(5)], mug);
  k.box(g, [c(30), c(4), c(22)], [c(20), c(77), c(-5)], k.mat("#2f7de1"));
  k.box(g, [c(28), c(3), c(20)], [c(21), c(80.5), c(-4)], k.mat("#e2413b"));
  k.box(g, [c(18), c(2), c(5)], [c(-2), c(76), c(-18)], k.mat("#1c1e22", { spec: 0.6 }));
}

export function tvStand(k: Kit, g: G, screen = true): void {
  const wood = k.mat("#3b2a1f", { spec: 0.2 });
  k.box(g, [c(160), c(50), c(42)], [0, c(25), c(21)], wood);
  if (screen) {
    k.box(g, [c(120), c(70), c(5)], [0, c(98), c(14)], k.mat("#0b0d10", { spec: 1, power: 128 }));
    k.box(g, [c(114), c(64), c(1)], [0, c(98), c(16.6)], k.mat("#1b3550", { emissive: 0.4, spec: 1 }));
    k.box(g, [c(30), c(4), c(18)], [0, c(52), c(14)], k.mat("#1c1e22"));
  }
  k.box(g, [c(40), c(8), c(20)], [c(-45), c(54), c(22)], k.mat("#2a2d31"));
}

export function bookshelf(k: Kit, g: G, widthCm = 90, heightCm = 200, wood = "#6b4a2f"): void {
  const w = c(widthCm);
  const m = k.mat(wood, { spec: 0.2 });
  const shelves = Math.round(heightCm / 38);
  k.box(g, [w, c(heightCm), c(2)], [0, c(heightCm / 2), c(1)], m);
  for (const s of [-1, 1]) k.box(g, [c(3), c(heightCm), c(30)], [s * (w / 2 - c(1.5)), c(heightCm / 2), c(15)], m);
  const colors = ["#7d1f24", "#1e2b4f", "#1f6b4a", "#c0a062", "#5b3a6e", "#d9a441", "#2f7de1", "#a33", "#e8d6b0"];
  for (let i = 0; i <= shelves; i++) {
    const y = (c(heightCm) / shelves) * i;
    k.box(g, [w - c(6), c(2.5), c(30)], [0, y + c(1), c(15)], m);
    if (i === shelves) break;
    let x = -w / 2 + c(5);
    let n = i * 7;
    while (x < w / 2 - c(8)) {
      const bw = c(3 + ((n * 37) % 5));
      const bh = c(22 + ((n * 13) % 10));
      const lean = n % 11 === 0 ? 0.25 : 0;
      k.box(g, [bw, bh, c(22)], [x + bw / 2, y + c(2.5) + bh / 2, c(16)], k.mat(colors[n % colors.length]!, { surface: "leather" }), [0, 0, lean]);
      x += bw + c(0.6) + (lean ? c(6) : 0);
      n++;
    }
  }
}

export function floorLamp(k: Kit, g: G): void {
  const metal = k.mat("#2a2d31", { spec: 0.8 });
  k.cyl(g, c(30), c(3), [0, c(1.5), c(25)], metal);
  k.cyl(g, c(3), c(150), [0, c(78), c(25)], metal);
  k.cyl(g, c(28), c(30), [0, c(160), c(25)], k.mat("#f6e7c1", { emissive: 0.6, spec: 0.1 }), { top: c(20) });
}

export function plant(k: Kit, g: G, x = 0, z = c(25), size = 1): void {
  k.cyl(g, c(30 * size), c(32 * size), [x, c(16 * size), z], k.mat("#b4583a", { rough: 0.85, surface: "none" }), { top: c(36 * size) });
  k.cyl(g, c(32 * size), c(2), [x, c(32 * size), z], k.mat("#3b2a1f", { surface: "dirt" }));
  const leaf = k.mat("#2f7a3d", { spec: 0.3 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    k.sphere(g, c(26 * size), [x + Math.cos(a) * c(12 * size), c((50 + (i % 3) * 14) * size), z + Math.sin(a) * c(12 * size)], leaf, [0.6, 1.4, 0.35]);
  }
}

export function windowFrame(k: Kit, g: G, wCm: number, hCm: number, sillCm: number, sky = "#bfe3ff"): void {
  const frame = k.mat("#f4f4f2", { spec: 0.3 });
  const w = c(wCm);
  const h = c(hCm);
  const y = c(sillCm) + h / 2;
  k.box(g, [w, h, c(1)], [0, y, c(0.5)], k.mat(sky, { emissive: 0.9 }));
  for (const s of [-1, 1]) k.box(g, [c(6), h + c(6), c(6)], [s * (w / 2), y, c(3)], frame);
  k.box(g, [w + c(6), c(6), c(6)], [0, y + h / 2, c(3)], frame);
  k.box(g, [w + c(16), c(4), c(14)], [0, c(sillCm) - c(2), c(7)], frame);
  k.box(g, [c(4), h, c(4)], [0, y, c(2)], frame);
  k.box(g, [w, c(4), c(4)], [0, y, c(2)], frame);
  const curtain = k.mat("#d9c7a3", { surface: "linen" });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) k.cyl(g, c(10), h + c(30), [s * (w / 2 + c(12 + i * 7)), y + c(5), c(8)], curtain);
  }
  k.cyl(g, c(3), w + c(90), [0, y + h / 2 + c(20), c(8)], k.mat("#5a5048", { spec: 0.6 }), { rot: [0, 0, Math.PI / 2] });
}

export function door(k: Kit, g: G): void {
  const wood = k.mat("#e8e2d6", { spec: 0.3 });
  k.box(g, [c(84), c(205), c(4)], [0, c(102.5), c(2)], wood);
  for (const [y, hh] of [[60, 70], [150, 70]] as const) k.box(g, [c(60), c(hh), c(1)], [0, c(y), c(4.5)], k.mat("#ddd6c8"));
  k.sphere(g, c(6), [c(34), c(100), c(6)], k.mat("#c9a227", { spec: 1, power: 96 }));
  for (const s of [-1, 1]) k.box(g, [c(8), c(215), c(6)], [s * c(46), c(107.5), c(3)], k.mat("#f4f4f2"));
  k.box(g, [c(100), c(8), c(6)], [0, c(210), c(3)], k.mat("#f4f4f2"));
}

export function picture(k: Kit, g: G, wCm: number, hCm: number, yCm: number, art: string): void {
  k.box(g, [c(wCm + 6), c(hCm + 6), c(2)], [0, c(yCm), c(1)], k.mat("#2a1e14", { spec: 0.4 }));
  k.box(g, [c(wCm), c(hCm), c(1)], [0, c(yCm), c(2.4)], k.mat(art, { surface: "linen" }));
  k.sphere(g, c(Math.min(wCm, hCm) * 0.4), [c(wCm * 0.15), c(yCm + hCm * 0.1), c(3)], k.mat("#e8b81a", { surface: "linen" }), [1, 1, 0.1]);
}

export function radiator(k: Kit, g: G): void {
  const m = k.mat("#f2f2f2", { spec: 0.5 });
  for (let i = 0; i < 12; i++) k.box(g, [c(4), c(55), c(8)], [c(-36 + i * 6.5), c(40), c(6)], m);
  k.box(g, [c(80), c(4), c(6)], [0, c(13), c(6)], m);
}

export function bed(k: Kit, g: G, duvet = "#5b8fd9"): void {
  const wood = k.mat("#a0673a", { spec: 0.2 });
  k.box(g, [c(160), c(30), c(205)], [0, c(15), c(102)], wood);
  k.box(g, [c(160), c(100), c(6)], [0, c(50), c(3)], wood);
  k.box(g, [c(150), c(22), c(195)], [0, c(41), c(102)], k.mat("#f6f3ee", { surface: "linen" }));
  k.box(g, [c(156), c(10), c(140)], [0, c(56), c(128)], k.mat(duvet, { surface: "fleece" }));
  k.box(g, [c(156), c(22), c(8)], [0, c(44), c(198)], k.mat(duvet, { surface: "fleece" }));
  for (const s of [-1, 1]) k.sphere(g, c(55), [s * c(38), c(60), c(28)], k.mat("#f4f2ee", { surface: "linen" }), [1, 0.35, 0.6]);
  k.sphere(g, c(30), [c(30), c(70), c(60)], k.mat("#c9a07a", { surface: "fleece" }), [1, 1, 1]);
  k.sphere(g, c(20), [c(30), c(92), c(60)], k.mat("#c9a07a", { surface: "fleece" }));
}

export function wardrobe(k: Kit, g: G): void {
  const wood = k.mat("#d8c3a5", { spec: 0.2 });
  k.box(g, [c(120), c(210), c(60)], [0, c(105), c(30)], wood);
  k.box(g, [c(1), c(200), c(1)], [0, c(108), c(60.5)], k.mat("#b39a7c"));
  for (const s of [-1, 1]) k.box(g, [c(2), c(30), c(3)], [s * c(6), c(110), c(62)], k.mat("#c9a227", { spec: 1 }));
}

export function desk(k: Kit, g: G, lamp = true): void {
  table(k, g, 130, 65, "#e8e2d6");
  k.box(g, [c(40), c(25), c(1.5)], [c(-20), c(98), c(15)], k.mat("#1c1e22", { spec: 0.8 }));
  k.box(g, [c(36), c(21), c(0.5)], [c(-20), c(98), c(16)], k.mat("#3a7bd5", { emissive: 0.5 }));
  k.box(g, [c(42), c(2), c(28)], [c(-20), c(76), c(-2)], k.mat("#2a2d31"));
  if (lamp) {
    const metal = k.mat("#2f7a3d", { spec: 0.7 });
    k.cyl(g, c(14), c(2), [c(40), c(76), c(10)], metal);
    k.cyl(g, c(2), c(40), [c(40), c(96), c(10)], metal);
    k.cyl(g, c(16), c(10), [c(40), c(116), c(18)], k.mat("#2f7a3d", { spec: 0.9 }), { top: c(6), rot: [0.6, 0, 0] });
  }
  for (let i = 0; i < 3; i++) k.box(g, [c(20), c(3), c(26)], [c(30), c(76.5 + i * 3), c(-15)], k.mat(["#e2413b", "#ffc933", "#2f7de1"][i]!));
}

export function nightstand(k: Kit, g: G): void {
  const wood = k.mat("#a0673a", { spec: 0.2 });
  k.box(g, [c(45), c(55), c(40)], [0, c(27.5), c(20)], wood);
  k.sphere(g, c(3), [0, c(40), c(41)], k.mat("#c9a227", { spec: 1 }));
  k.cyl(g, c(12), c(25), [c(-8), c(68), c(20)], k.mat("#f2e1b9", { spec: 0.4 }));
  k.cyl(g, c(22), c(16), [c(-8), c(86), c(20)], k.mat("#f6e7c1", { emissive: 0.6 }), { top: c(14) });
  k.box(g, [c(12), c(7), c(6)], [c(12), c(58.5), c(22)], k.mat("#e2413b", { spec: 0.6 }));
}

export function poster(k: Kit, g: G, yCm: number, color: string, accent: string): void {
  k.box(g, [c(50), c(70), c(0.5)], [0, c(yCm), c(0.5)], k.mat(color, { spec: 0.1 }));
  k.sphere(g, c(28), [0, c(yCm + 8), c(1)], k.mat(accent, { spec: 0.2 }), [1, 1, 0.05]);
  k.box(g, [c(40), c(6), c(0.6)], [0, c(yCm - 24), c(1)], k.mat("#ffffff"));
}

// ------------------------------------------------------------------ bathroom

export function bathtub(k: Kit, g: G): void {
  const enamel = k.mat("#fbfbfb", { spec: 0.9, power: 96 });
  const chrome = k.mat("#d9dde2", { spec: 1, power: 128 });
  k.box(g, [c(170), c(56), c(76)], [0, c(28), c(38)], enamel);
  k.box(g, [c(156), c(4), c(62)], [0, c(48), c(38)], k.mat("#9fd8ff", { alpha: 0.55, spec: 1, power: 128 }));
  for (let i = 0; i < 14; i++) k.sphere(g, c(8 + (i % 3) * 3), [c(-60 + i * 9), c(51), c(30 + (i % 4) * 7)], k.mat("#ffffff", { spec: 0.4 }));
  k.cyl(g, c(4), c(25), [c(-75), c(68), c(10)], chrome);
  k.cyl(g, c(3), c(14), [c(-75), c(80), c(16)], chrome, { rot: [Math.PI / 2, 0, 0] });
  k.cyl(g, c(3), c(180), [0, c(200), c(76)], chrome, { rot: [0, 0, Math.PI / 2] });
  const curtain = k.mat("#7fd1c7", { spec: 0.05, alpha: 0.85 });
  for (let i = 0; i < 8; i++) k.cyl(g, c(10), c(130), [c(55 + i * 4.5), c(132), c(76)], curtain);
  k.sphere(g, c(16), [c(20), c(56), c(40)], k.mat("#ffd21a", { spec: 0.6 }), [1.2, 1, 1]);
  k.sphere(g, c(10), [c(26), c(66), c(40)], k.mat("#ffd21a", { spec: 0.6 }));
}

export function toilet(k: Kit, g: G): void {
  const ceramic = k.mat("#fbfbfb", { spec: 0.9, power: 96 });
  k.box(g, [c(38), c(40), c(18)], [0, c(65), c(9)], ceramic);
  k.cyl(g, c(30), c(40), [0, c(20), c(38)], ceramic, { top: c(36) });
  k.torus(g, c(36), c(5), [0, c(42), c(42)], ceramic);
  k.box(g, [c(36), c(2), c(42)], [0, c(46), c(38)], k.mat("#f2f2f2"));
  k.box(g, [c(8), c(3), c(4)], [c(12), c(84), c(9)], k.mat("#d9dde2", { spec: 1 }));
}

export function vanity(k: Kit, g: G): void {
  const cab = k.mat("#7d8f9e", { spec: 0.3 });
  const ceramic = k.mat("#fbfbfb", { spec: 0.9 });
  k.box(g, [c(80), c(80), c(48)], [0, c(40), c(24)], cab);
  k.box(g, [c(84), c(6), c(52)], [0, c(83), c(26)], ceramic);
  k.cyl(g, c(40), c(3), [0, c(86), c(28)], k.mat("#e8edf2", { spec: 1 }));
  k.cyl(g, c(3), c(18), [0, c(95), c(8)], k.mat("#d9dde2", { spec: 1 }));
  k.box(g, [c(70), c(80), c(2)], [0, c(150), c(2)], k.mat("#b8d4e8", { spec: 1, power: 160, emissive: 0.15 }));
  k.box(g, [c(74), c(4), c(4)], [0, c(192), c(3)], k.mat("#f4f1ea", { emissive: 0.6 }));
  k.cyl(g, c(7), c(12), [c(-28), c(92), c(30)], k.mat("#ff6fb5", { spec: 0.6 }));
  k.cyl(g, c(6), c(16), [c(-18), c(94), c(30)], k.mat("#3ddc84", { spec: 0.6 }));
  k.cyl(g, c(7), c(11), [c(28), c(91.5), c(30)], k.mat("#f2f2f2", { spec: 0.4 }));
  k.cyl(g, c(1), c(15), [c(26), c(102), c(30)], k.mat("#2f7de1"));
}

export function towelRail(k: Kit, g: G): void {
  const chrome = k.mat("#d9dde2", { spec: 1, power: 128 });
  k.cyl(g, c(2.5), c(70), [0, c(120), c(8)], chrome, { rot: [0, 0, Math.PI / 2] });
  k.box(g, [c(50), c(60), c(3)], [c(-5), c(95), c(9)], k.mat("#e2413b", { spec: 0.02 }));
  k.box(g, [c(30), c(70), c(3)], [c(20), c(90), c(11)], k.mat("#f2f2f2", { spec: 0.02 }));
}

export function laundryBasket(k: Kit, g: G): void {
  k.cyl(g, c(45), c(55), [0, c(27.5), c(30)], k.mat("#c9a07a", { spec: 0.1 }), { top: c(50), tess: 12 });
  k.sphere(g, c(40), [0, c(55), c(30)], k.mat("#5b8fd9", { spec: 0.04 }), [1, 0.4, 1]);
}

// ------------------------------------------------------------------ workshop

export function workbench(k: Kit, g: G): void {
  const wood = k.mat("#b5835a", { spec: 0.15 });
  const steel = k.mat("#7a828c", { spec: 0.8 });
  k.box(g, [c(200), c(6), c(75)], [0, c(90), c(37)], wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(g, [c(6), c(87), c(6)], [sx * c(94), c(43.5), c(37) + sz * c(32)], wood);
  k.box(g, [c(190), c(4), c(65)], [0, c(30), c(37)], wood);
  k.box(g, [c(200), c(120), c(2)], [0, c(160), c(1)], k.mat("#c9a07a", { spec: 0.1 }));
  for (let i = 0; i < 12; i++) for (let j = 0; j < 7; j++) k.cyl(g, c(1.2), c(1), [c(-90 + i * 16), c(110 + j * 16), c(2.2)], k.mat("#6b4a2f"), { rot: [Math.PI / 2, 0, 0], tess: 6 });
  // Hammer, wrench, screwdrivers, saw on the pegboard.
  k.box(g, [c(4), c(30), c(3)], [c(-70), c(160), c(4)], k.mat("#7a4a2a"));
  k.box(g, [c(14), c(5), c(5)], [c(-70), c(176), c(4)], steel);
  k.box(g, [c(4), c(26), c(2)], [c(-45), c(160), c(4)], steel);
  k.torus(g, c(8), c(2.4), [c(-45), c(175), c(4)], steel, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    k.cyl(g, c(4), c(12), [c(-15 + i * 9), c(170), c(4)], k.mat(["#e2413b", "#ffc933", "#2f7de1"][i]!), { tess: 6 });
    k.cyl(g, c(1.2), c(14), [c(-15 + i * 9), c(157), c(4)], steel, { tess: 6 });
  }
  k.box(g, [c(50), c(18), c(1)], [c(40), c(165), c(3)], steel, [0, 0, 0.1]);
  k.box(g, [c(12), c(14), c(4)], [c(66), c(165), c(4)], k.mat("#e2413b"));
  // Vice on the bench edge.
  k.box(g, [c(18), c(14), c(20)], [c(80), c(100), c(70)], k.mat("#2f4f7a", { spec: 0.6 }));
  k.cyl(g, c(2), c(26), [c(80), c(100), c(84)], steel, { rot: [Math.PI / 2, 0, 0] });
  // Clutter on the top.
  k.cyl(g, c(14), c(16), [c(-30), c(101), c(40)], k.mat("#e2413b", { spec: 0.5 }));
  k.cyl(g, c(14), c(1), [c(-30), c(109.5), c(40)], k.mat("#c0c4c8"));
  for (let i = 0; i < 8; i++) k.cyl(g, c(2), c(1.2), [c(10 + (i % 4) * 5), c(93.6), c(30 + Math.floor(i / 4) * 6)], steel, { tess: 6 });
}

export function toolChest(k: Kit, g: G): void {
  const red = k.mat("#c8331f", { spec: 0.7, power: 64 });
  const chrome = k.mat("#d9dde2", { spec: 1 });
  k.box(g, [c(70), c(100), c(46)], [0, c(54), c(23)], red);
  for (let i = 0; i < 6; i++) {
    k.box(g, [c(66), c(1), c(1)], [0, c(18 + i * 15), c(46.5)], k.mat("#8a1f12"));
    k.box(g, [c(40), c(2), c(3)], [0, c(25 + i * 15), c(47.5)], chrome);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.sphere(g, c(7), [sx * c(28), c(3.5), c(23) + sz * c(17)], k.mat("#1c1e22"));
}

export function tyreStack(k: Kit, g: G): void {
  const rubber = k.mat("#151618", { spec: 0.1 });
  for (let i = 0; i < 4; i++) {
    k.torus(g, c(48), c(18), [c(i % 2 ? 2 : -2), c(10 + i * 19), c(32)], rubber);
    k.cyl(g, c(30), c(16), [c(i % 2 ? 2 : -2), c(10 + i * 19), c(32)], k.mat("#7a828c", { spec: 0.8 }));
  }
}

export function shelves(k: Kit, g: G): void {
  const steel = k.mat("#5d646e", { spec: 0.5 });
  for (const sx of [-1, 1]) for (const sz of [0, 1]) k.box(g, [c(4), c(190), c(4)], [sx * c(58), c(95), c(4 + sz * 36)], steel);
  const cans = ["#2f7de1", "#e2413b", "#ffc933", "#3ddc84", "#f2f2f2"];
  for (let i = 0; i < 4; i++) {
    const y = c(20 + i * 50);
    k.box(g, [c(120), c(3), c(42)], [0, y, c(22)], steel);
    for (let j = 0; j < 5; j++) {
      if ((i + j) % 3 === 0) k.box(g, [c(20), c(18), c(26)], [c(-48 + j * 24), y + c(10.5), c(22)], k.mat("#b88a52", { rough: 0.9, surface: "none" }));
      else k.cyl(g, c(18), c(20), [c(-48 + j * 24), y + c(11.5), c(22)], k.mat(cans[(i + j) % cans.length]!, { spec: 0.7 }));
    }
  }
}

export function ladder(k: Kit, g: G): void {
  const alu = k.mat("#c8cdd3", { spec: 0.9 });
  for (const s of [-1, 1]) k.box(g, [c(5), c(220), c(4)], [s * c(22), c(108), c(28)], alu, [0.22, 0, 0]);
  for (let i = 0; i < 7; i++) k.box(g, [c(44), c(3), c(4)], [0, c(25 + i * 30), c(34 - i * 6.5)], alu);
}

export function oilDrum(k: Kit, g: G): void {
  k.cyl(g, c(58), c(88), [0, c(44), c(32)], k.mat("#2f7de1", { spec: 0.7 }));
  for (const y of [20, 44, 68]) k.torus(g, c(59), c(2), [0, c(y), c(32)], k.mat("#1e4f8f"));
}

export function garageDoor(k: Kit, g: G, wCm: number): void {
  const panel = k.mat("#e3e5e8", { spec: 0.4 });
  for (let i = 0; i < 7; i++) k.box(g, [c(wCm), c(30), c(4)], [0, c(18 + i * 31), c(2)], panel);
  k.box(g, [c(30), c(4), c(5)], [0, c(40), c(5)], k.mat("#7a828c", { spec: 0.9 }));
}

// ------------------------------------------------------------------ library

export function readingChair(k: Kit, g: G): void {
  armchair(k, g, "#6e2a2a");
}

export function globe(k: Kit, g: G): void {
  const wood = k.mat("#6b4a2f", { spec: 0.3 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.cyl(g, c(3), c(60), [Math.cos(a) * c(15), c(28), c(30) + Math.sin(a) * c(15)], wood, { rot: [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25] });
  }
  k.torus(g, c(48), c(2), [0, c(85), c(30)], k.mat("#c9a227", { spec: 1 }), [Math.PI / 2, 0, 0.4]);
  k.sphere(g, c(44), [0, c(85), c(30)], k.mat("#2f6f9e", { spec: 0.5 }));
  k.sphere(g, c(20), [c(10), c(95), c(42)], k.mat("#3d8b4a", { spec: 0.2 }), [1, 0.7, 0.3]);
}

export function bookStack(k: Kit, g: G, n: number): void {
  const colors = ["#7d1f24", "#1e2b4f", "#1f6b4a", "#c0a062", "#5b3a6e", "#d9a441"];
  for (let i = 0; i < n; i++) {
    k.box(g, [c(28 - (i % 3) * 2), c(5), c(20)], [c((i % 2) * 2), c(2.5 + i * 5), c(20)], k.mat(colors[i % colors.length]!, { surface: "leather" }), [0, (i * 0.37) % 0.6 - 0.3, 0]);
  }
}

export function clock(k: Kit, g: G, yCm: number): void {
  k.cyl(g, c(40), c(5), [0, c(yCm), c(2.5)], k.mat("#f2f2f2", { spec: 0.5 }), { rot: [Math.PI / 2, 0, 0] });
  k.torus(g, c(40), c(3), [0, c(yCm), c(4)], k.mat("#2a1e14"), [Math.PI / 2, 0, 0]);
  k.box(g, [c(1.5), c(14), c(1)], [0, c(yCm + 6), c(5.5)], k.mat("#111"));
  k.box(g, [c(10), c(1.5), c(1)], [c(4), c(yCm), c(5.5)], k.mat("#111"));
}

// ------------------------------------------------------------------ garden / sandbox (outdoors)

export function tree(k: Kit, g: G, size = 1): void {
  k.cyl(g, c(30 * size), c(260 * size), [0, c(130 * size), 0], k.mat("#6a5444", { surface: "bark" }), { top: c(18 * size), tess: 10 });
  const leaf = ["#2f7a3d", "#3d8b4a", "#25643a"];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = c((60 + (i % 3) * 25) * size);
    k.sphere(g, c((150 + (i % 4) * 30) * size), [Math.cos(a) * r, c((260 + (i % 3) * 50) * size), Math.sin(a) * r], k.mat(leaf[i % 3]!, { spec: 0.05 }));
  }
}

export function bush(k: Kit, g: G, size = 1): void {
  for (let i = 0; i < 5; i++) k.sphere(g, c((60 + i * 8) * size), [c((i - 2) * 22 * size), c(30 * size), c((i % 2) * 18 * size)], k.mat(i % 2 ? "#2f7a3d" : "#3d8b4a", { spec: 0.05 }));
}

export function flowerBed(k: Kit, g: G, widthCm: number): void {
  const w = c(widthCm);
  k.box(g, [w, c(12), c(60)], [0, c(6), c(30)], k.mat("#5a3a22", { surface: "dirt" }));
  const petals = ["#e2413b", "#ffc933", "#ff6fb5", "#c45bff", "#ffffff", "#ff7a1a"];
  const n = Math.round(widthCm / 14);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    const z = c(15 + (i % 3) * 15);
    const h = c(35 + (i * 13) % 25);
    k.cyl(g, c(1.5), h, [x, c(12) + h / 2, z], k.mat("#2f7a3d"), { tess: 5 });
    k.sphere(g, c(12), [x, c(12) + h, z], k.mat(petals[i % petals.length]!, { spec: 0.2 }), [1, 0.45, 1]);
    k.sphere(g, c(4), [x, c(14) + h, z], k.mat("#ffd21a"));
  }
}

export function fence(k: Kit, g: G, lengthCm: number): void {
  const wood = k.mat("#f2ead8", { spec: 0.1 });
  const n = Math.round(lengthCm / 14);
  for (let i = 0; i < n; i++) k.box(g, [c(10), c(110), c(3)], [c(-lengthCm / 2 + 7 + i * 14), c(55), c(4)], wood);
  for (const y of [30, 85]) k.box(g, [c(lengthCm), c(8), c(3)], [0, c(y), c(1)], wood);
}

export function wateringCan(k: Kit, g: G): void {
  const m = k.mat("#3ddc84", { spec: 0.7 });
  k.cyl(g, c(24), c(26), [0, c(13), c(30)], m);
  k.cyl(g, c(3), c(34), [c(18), c(24), c(30)], m, { rot: [0, 0, -0.9] });
  k.torus(g, c(16), c(2.5), [c(-4), c(30), c(30)], m);
}

export function hoseReel(k: Kit, g: G): void {
  k.torus(g, c(50), c(10), [0, c(40), c(20)], k.mat("#3ddc84", { spec: 0.4 }), [0, Math.PI / 2, 0]);
  k.cyl(g, c(30), c(26), [0, c(40), c(20)], k.mat("#c8331f"), { rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) k.box(g, [c(4), c(70), c(4)], [s * c(16), c(35), c(20)], k.mat("#c8331f"));
}

export function gnome(k: Kit, g: G): void {
  k.cyl(g, c(20), c(22), [0, c(11), c(20)], k.mat("#2f7de1", { spec: 0.4 }), { top: c(16) });
  k.sphere(g, c(14), [0, c(28), c(20)], k.mat("#f2c9a8"));
  k.sphere(g, c(16), [0, c(24), c(24)], k.mat("#f2f2f2"), [1, 1.2, 0.6]);
  k.cyl(g, c(18), c(26), [0, c(42), c(20)], k.mat("#e2413b", { spec: 0.4 }), { top: c(0.5) });
}

export function birdbath(k: Kit, g: G): void {
  const stone = k.mat("#b9b5ad", { surface: "rock" });
  k.cyl(g, c(30), c(8), [0, c(4), c(30)], stone);
  k.cyl(g, c(12), c(60), [0, c(38), c(30)], stone);
  k.cyl(g, c(56), c(10), [0, c(72), c(30)], stone, { top: c(64) });
  k.cyl(g, c(52), c(1), [0, c(77.5), c(30)], k.mat("#9fd8ff", { alpha: 0.6, spec: 1 }));
}

export function bench(k: Kit, g: G): void {
  const wood = k.mat("#8a5a36", { spec: 0.15 });
  const iron = k.mat("#1c1e22", { spec: 0.5 });
  for (let i = 0; i < 4; i++) k.box(g, [c(150), c(3), c(10)], [0, c(45), c(15 + i * 12)], wood);
  for (let i = 0; i < 3; i++) k.box(g, [c(150), c(10), c(3)], [0, c(60 + i * 13), c(10)], wood);
  for (const s of [-1, 1]) {
    k.box(g, [c(5), c(45), c(5)], [s * c(65), c(22), c(18)], iron);
    k.box(g, [c(5), c(45), c(5)], [s * c(65), c(22), c(52)], iron);
    k.box(g, [c(5), c(50), c(5)], [s * c(65), c(70), c(8)], iron);
  }
}

export function slide(k: Kit, g: G): void {
  const plastic = k.mat("#e2413b", { spec: 0.6 });
  const metal = k.mat("#2f7de1", { spec: 0.7 });
  k.box(g, [c(50), c(4), c(240)], [0, c(90), c(130)], plastic, [-0.62, 0, 0]);
  for (const s of [-1, 1]) {
    k.box(g, [c(5), c(180), c(5)], [s * c(30), c(90), c(10)], metal);
    k.box(g, [c(5), c(20), c(240)], [s * c(27), c(98), c(130)], plastic, [-0.62, 0, 0]);
  }
  for (let i = 0; i < 6; i++) k.box(g, [c(56), c(4), c(6)], [0, c(20 + i * 30), c(10)], metal);
  k.box(g, [c(70), c(5), c(60)], [0, c(180), c(15)], k.mat("#ffc933", { spec: 0.4 }));
}

export function swingSet(k: Kit, g: G): void {
  const frame = k.mat("#3ddc84", { spec: 0.5 });
  for (const s of [-1, 1]) {
    for (const z of [-1, 1]) k.box(g, [c(6), c(250), c(6)], [s * c(110), c(120), c(60) + z * c(40)], frame, [z * 0.18, 0, 0]);
  }
  k.cyl(g, c(8), c(230), [0, c(240), c(60)], frame, { rot: [0, 0, Math.PI / 2] });
  for (const x of [-50, 50]) {
    for (const d of [-20, 20]) k.cyl(g, c(1.5), c(170), [c(x + d), c(155), c(60)], k.mat("#7a828c", { spec: 0.9 }), { tess: 6 });
    k.box(g, [c(50), c(4), c(20)], [c(x), c(70), c(60)], k.mat("#ffc933"));
  }
}

export function sandCastle(k: Kit, g: G): void {
  const sand = k.mat("#d9b878", { spec: 0.02 });
  k.cyl(g, c(70), c(30), [0, c(15), c(40)], sand, { top: c(60) });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.cyl(g, c(20), c(46), [Math.cos(a) * c(26), c(23), c(40) + Math.sin(a) * c(26)], sand, { top: c(16) });
    for (let j = 0; j < 4; j++) k.box(g, [c(5), c(6), c(5)], [Math.cos(a) * c(26) + Math.cos(j * 1.57) * c(7), c(49), c(40) + Math.sin(a) * c(26) + Math.sin(j * 1.57) * c(7)], sand);
  }
  k.cyl(g, c(1), c(30), [0, c(60), c(40)], k.mat("#5a3a22"));
  k.box(g, [c(12), c(8), c(0.5)], [c(6), c(70), c(40)], k.mat("#e2413b"));
}

export function bucketSpade(k: Kit, g: G, color: string): void {
  k.cyl(g, c(26), c(26), [0, c(13), c(30)], k.mat(color, { spec: 0.5 }), { top: c(32) });
  k.torus(g, c(30), c(1.5), [0, c(30), c(30)], k.mat("#f2f2f2"), [0, 0, Math.PI / 2]);
  k.box(g, [c(4), c(40), c(2)], [c(30), c(22), c(30)], k.mat("#ffc933"), [0, 0, 0.4]);
  k.box(g, [c(14), c(16), c(2)], [c(38), c(4), c(30)], k.mat("#ffc933"), [0, 0, 0.4]);
}

export function paddlingPool(k: Kit, g: G, dCm: number): void {
  k.torus(g, c(dCm), c(28), [0, c(14), 0], k.mat("#2f7de1", { spec: 0.7 }));
  k.torus(g, c(dCm - 20), c(16), [0, c(34), 0], k.mat("#ff6fb5", { spec: 0.7 }));
  k.cyl(g, c(dCm - 10), c(16), [0, c(10), 0], k.mat("#9fd8ff", { alpha: 0.6, spec: 1, power: 128 }));
}

export function beachUmbrella(k: Kit, g: G): void {
  k.cyl(g, c(4), c(200), [0, c(100), 0], k.mat("#f2f2f2", { spec: 0.6 }));
  const colors = ["#e2413b", "#f2f2f2"];
  for (let i = 0; i < 8; i++) k.cyl(g, c(180), c(6), [0, c(200 - i * 0.5), 0], k.mat(colors[i % 2]!, { spec: 0.2 }), { top: c(10), tess: 8, rot: [0, (i * Math.PI) / 8, 0] });
}

// ------------------------------------------------------------------ toys

export function toyBlocksTower(k: Kit, g: G, n = 6): void {
  const colors = ["#e2413b", "#ffc933", "#2f7de1", "#3ddc84", "#c45bff"];
  for (let i = 0; i < n; i++) k.box(g, [c(16), c(16), c(16)], [c((i % 2) * 4 - 2), c(8 + i * 16), c(20)], k.mat(colors[i % colors.length]!, { spec: 0.3 }), [0, i * 0.3, 0]);
}

export function teddy(k: Kit, g: G): void {
  const fur = k.mat("#a0673a", { surface: "fleece" });
  k.sphere(g, c(40), [0, c(22), c(25)], fur, [1, 1.1, 0.9]);
  k.sphere(g, c(30), [0, c(54), c(25)], fur);
  for (const s of [-1, 1]) {
    k.sphere(g, c(12), [s * c(11), c(68), c(25)], fur);
    k.sphere(g, c(14), [s * c(18), c(14), c(36)], fur);
    k.sphere(g, c(14), [s * c(22), c(32), c(28)], fur);
    k.sphere(g, c(4), [s * c(6), c(58), c(38)], k.mat("#111"));
  }
  k.sphere(g, c(10), [0, c(50), c(38)], k.mat("#d9b08c"));
  k.sphere(g, c(4), [0, c(52), c(43)], k.mat("#111"));
}

export function toyBox(k: Kit, g: G): void {
  k.box(g, [c(80), c(50), c(50)], [0, c(25), c(25)], k.mat("#2f7de1", { spec: 0.4 }));
  k.box(g, [c(84), c(5), c(54)], [0, c(53), c(22)], k.mat("#ffc933", { spec: 0.4 }), [-0.5, 0, 0]);
  k.sphere(g, c(24), [c(-20), c(52), c(25)], k.mat("#e2413b", { spec: 0.6 }));
  k.box(g, [c(16), c(16), c(16)], [c(18), c(55), c(28)], k.mat("#3ddc84"), [0.4, 0.3, 0]);
}

export function beachBall(k: Kit, g: G, x: number, z: number): void {
  const colors = ["#e2413b", "#ffc933", "#2f7de1", "#f2f2f2"];
  colors.forEach((col, i) => k.sphere(g, c(40 - i * 0.3), [x, c(20), z], k.mat(col, { spec: 0.6 }), [1, 1, 1 - i * 0.02]));
}
