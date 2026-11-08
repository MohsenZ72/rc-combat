import { DynamicTexture, type Scene } from "@babylonjs/core";
import type { Cosmetics, StickerId, StickerSlot } from "@rc/shared";

/**
 * Livery canvas mapped onto the lofted shell: u runs around the
 * cross-section (0.25 = one door, 0.5 = roof centre, 0.75 = other door),
 * v runs rear (0) → nose (1).
 */
const SLOT_UV: Record<StickerSlot, { u: number; v: number; rot: number; size: number }> = {
  hood: { u: 0.5, v: 0.84, rot: Math.PI, size: 0.17 },
  roof: { u: 0.5, v: 0.48, rot: Math.PI, size: 0.17 },
  doorL: { u: 0.25, v: 0.3, rot: Math.PI / 2, size: 0.15 },
  doorR: { u: 0.75, v: 0.3, rot: -Math.PI / 2, size: 0.15 },
  rear: { u: 0.5, v: 0.14, rot: Math.PI, size: 0.14 },
};

export function liveryTexture(scene: Scene, key: string, c: Cosmetics): DynamicTexture {
  const S = 1024;
  const tex = new DynamicTexture(`livery-${key}`, { width: S, height: S }, scene, true);
  const g = tex.getContext() as CanvasRenderingContext2D;
  g.fillStyle = c.paint;
  g.fillRect(0, 0, S, S);
  // Subtle panel shading so flat paint reads as a shaped body.
  const shade = g.createLinearGradient(0, 0, S, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.28)");
  shade.addColorStop(0.18, "rgba(0,0,0,0)");
  shade.addColorStop(0.5, "rgba(255,255,255,0.08)");
  shade.addColorStop(0.82, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.28)");
  g.fillStyle = shade;
  g.fillRect(0, 0, S, S);
  // Shut lines: door seams and bonnet line.
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 3;
  for (const u of [0.25, 0.75]) {
    g.beginPath();
    g.moveTo(S * u - 70, S * 0.4);
    g.lineTo(S * u + 70, S * 0.4);
    g.moveTo(S * u - 70, S * 0.66);
    g.lineTo(S * u + 70, S * 0.66);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(S * 0.38, S * 0.72);
  g.lineTo(S * 0.62, S * 0.72);
  g.stroke();

  for (const st of c.stickers) drawSticker(g, S, st.id, st.slot, c.accent);

  // Racing number roundels on both doors (always present, like real diecast toys).
  if (c.number > 0) {
    for (const u of [0.25, 0.75]) {
      g.save();
      g.translate(S * u, S * 0.55);
      g.rotate(u < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(0, 0, 66, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = c.accent;
      g.stroke();
      g.fillStyle = "#111111";
      g.font = "bold 84px 'Chakra Petch', Arial, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(c.number), 0, 4);
      g.restore();
    }
  }
  tex.update();
  return tex;
}

function drawSticker(g: CanvasRenderingContext2D, S: number, id: StickerId, slot: StickerSlot, accent: string): void {
  const p = SLOT_UV[slot];
  const r = S * p.size * 0.5;
  g.save();
  g.translate(S * p.u, S * p.v);
  g.rotate(p.rot);
  STICKER_ART[id](g, r, accent);
  g.restore();
}

type Art = (g: CanvasRenderingContext2D, r: number, accent: string) => void;

const outline = (g: CanvasRenderingContext2D, w = 6) => {
  g.lineWidth = w;
  g.strokeStyle = "#111";
  g.stroke();
};

function star(g: CanvasRenderingContext2D, r: number, points: number, inner = 0.45): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
}

function brand(text: string, bg: string, fg: string): Art {
  return (g, r) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(-r * 1.4, -r * 0.5, r * 2.8, r, r * 0.25);
    g.fill();
    outline(g, 4);
    g.fillStyle = fg;
    g.font = `italic bold ${Math.round(r * 0.62)}px 'Chakra Petch', Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 0, r * 0.05);
  };
}

/** 24 original sticker designs (no real brands). */
export const STICKER_ART: Record<StickerId, Art> = {
  flames: (g, r) => {
    const grad = g.createLinearGradient(-r, 0, r, 0);
    grad.addColorStop(0, "#ffe066");
    grad.addColorStop(0.5, "#ff7a1a");
    grad.addColorStop(1, "#d7263d");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-r * 1.3, r * 0.4);
    for (let i = 0; i < 5; i++) {
      const x = -r * 1.3 + i * r * 0.6;
      g.quadraticCurveTo(x + r * 0.2, -r * (0.9 - i * 0.08), x + r * 0.45, r * 0.05);
    }
    g.lineTo(r * 1.4, r * 0.4);
    g.closePath();
    g.fill();
    outline(g, 4);
  },
  bolt: (g, r) => {
    g.fillStyle = "#ffd21a";
    g.beginPath();
    g.moveTo(-r * 0.2, -r);
    g.lineTo(r * 0.5, -r);
    g.lineTo(r * 0.05, -r * 0.1);
    g.lineTo(r * 0.55, -r * 0.1);
    g.lineTo(-r * 0.4, r);
    g.lineTo(-r * 0.05, r * 0.05);
    g.lineTo(-r * 0.55, r * 0.05);
    g.closePath();
    g.fill();
    outline(g);
  },
  star: (g, r, a) => {
    star(g, r, 5);
    g.fillStyle = a;
    g.fill();
    outline(g);
  },
  checker: (g, r) => {
    const n = 6;
    const s = (r * 2) / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) {
      g.fillStyle = (i + j) % 2 === 0 ? "#111" : "#f2f2f2";
      g.fillRect(-r + i * s, -r * 0.5 + j * s, s, s);
    }
  },
  stripes: (g, r, a) => {
    g.fillStyle = a;
    g.fillRect(-r * 0.55, -r * 3, r * 0.4, r * 6);
    g.fillRect(r * 0.15, -r * 3, r * 0.4, r * 6);
  },
  tribal: (g, r, a) => {
    g.fillStyle = a;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, -r * 0.2);
      g.bezierCurveTo(s * r * 0.6, -r, s * r * 1.4, -r * 0.2, s * r * 1.3, r * 0.6);
      g.bezierCurveTo(s * r * 0.9, 0, s * r * 0.5, r * 0.1, 0, r * 0.4);
      g.closePath();
      g.fill();
    }
    outline(g, 3);
  },
  heart: (g, r) => {
    g.fillStyle = "#ff3d6e";
    g.beginPath();
    g.moveTo(0, r * 0.9);
    g.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.1, 0, -r * 0.4);
    g.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.4, -r * 0.1, 0, r * 0.9);
    g.fill();
    outline(g);
  },
  crown: (g, r) => {
    g.fillStyle = "#ffc933";
    g.beginPath();
    g.moveTo(-r, r * 0.6);
    g.lineTo(-r, -r * 0.4);
    g.lineTo(-r * 0.5, r * 0.1);
    g.lineTo(0, -r * 0.8);
    g.lineTo(r * 0.5, r * 0.1);
    g.lineTo(r, -r * 0.4);
    g.lineTo(r, r * 0.6);
    g.closePath();
    g.fill();
    outline(g);
  },
  paw: (g, r) => {
    g.fillStyle = "#111";
    g.beginPath();
    g.ellipse(0, r * 0.3, r * 0.5, r * 0.4, 0, 0, Math.PI * 2);
    g.fill();
    for (const [x, y] of [[-0.55, -0.35], [-0.2, -0.7], [0.2, -0.7], [0.55, -0.35]] as const) {
      g.beginPath();
      g.ellipse(x * r, y * r, r * 0.18, r * 0.24, 0, 0, Math.PI * 2);
      g.fill();
    }
  },
  rocket: (g, r) => {
    g.fillStyle = "#f2f2f2";
    g.beginPath();
    g.moveTo(0, -r);
    g.quadraticCurveTo(r * 0.45, -r * 0.3, r * 0.3, r * 0.5);
    g.lineTo(-r * 0.3, r * 0.5);
    g.quadraticCurveTo(-r * 0.45, -r * 0.3, 0, -r);
    g.fill();
    outline(g, 4);
    g.fillStyle = "#ff5a36";
    g.beginPath();
    g.moveTo(-r * 0.25, r * 0.5);
    g.lineTo(0, r);
    g.lineTo(r * 0.25, r * 0.5);
    g.fill();
    g.fillStyle = "#2f7de1";
    g.beginPath();
    g.arc(0, -r * 0.25, r * 0.16, 0, Math.PI * 2);
    g.fill();
  },
  eyes: (g, r) => {
    for (const s of [-1, 1]) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.ellipse(s * r * 0.5, 0, r * 0.42, r * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      outline(g, 4);
      g.fillStyle = "#111";
      g.beginPath();
      g.arc(s * r * 0.5 + r * 0.1, r * 0.1, r * 0.2, 0, Math.PI * 2);
      g.fill();
    }
  },
  wings: (g, r, a) => {
    g.fillStyle = a;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.ellipse(s * r * (0.45 + k * 0.28), -k * r * 0.12, r * 0.45, r * 0.14, s * -0.35, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = "#111";
    g.beginPath();
    g.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    g.fill();
  },
  sun: (g, r) => {
    g.fillStyle = "#ffb21a";
    star(g, r, 12, 0.7);
    g.fill();
    g.fillStyle = "#ffe066";
    g.beginPath();
    g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    g.fill();
  },
  wave: (g, r, a) => {
    g.strokeStyle = a;
    g.lineWidth = r * 0.22;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let x = -r * 1.3; x <= r * 1.3; x += 4) g.lineTo(x, Math.sin(x / (r * 0.3)) * r * 0.15 + (k - 1) * r * 0.45);
      g.stroke();
    }
  },
  skull: (g, r) => {
    g.fillStyle = "#f2f2f2";
    g.beginPath();
    g.arc(0, -r * 0.15, r * 0.7, Math.PI, 0);
    g.lineTo(r * 0.45, r * 0.7);
    g.lineTo(-r * 0.45, r * 0.7);
    g.closePath();
    g.fill();
    outline(g, 4);
    g.fillStyle = "#111";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(s * r * 0.28, -r * 0.1, r * 0.17, 0, Math.PI * 2);
      g.fill();
    }
  },
  clover: (g, r) => {
    g.fillStyle = "#1f9d55";
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      g.beginPath();
      g.arc(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.42, 0, Math.PI * 2);
      g.fill();
    }
  },
  dice: (g, r) => {
    g.fillStyle = "#f2f2f2";
    g.beginPath();
    g.roundRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6, r * 0.25);
    g.fill();
    outline(g, 4);
    g.fillStyle = "#111";
    for (const [x, y] of [[-0.4, -0.4], [0.4, 0.4], [0, 0], [0.4, -0.4], [-0.4, 0.4]] as const) {
      g.beginPath();
      g.arc(x * r, y * r, r * 0.13, 0, Math.PI * 2);
      g.fill();
    }
  },
  comet: (g, r, a) => {
    const grad = g.createLinearGradient(-r * 1.4, 0, r * 0.5, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, a);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-r * 1.4, -r * 0.1);
    g.lineTo(r * 0.3, -r * 0.4);
    g.lineTo(r * 0.3, r * 0.4);
    g.lineTo(-r * 1.4, r * 0.1);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(r * 0.45, 0, r * 0.38, 0, Math.PI * 2);
    g.fill();
  },
  diamond: (g, r) => {
    g.fillStyle = "#7fe3ff";
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.8, -r * 0.2);
    g.lineTo(0, r);
    g.lineTo(-r * 0.8, -r * 0.2);
    g.closePath();
    g.fill();
    outline(g, 4);
  },
  target: (g, r) => {
    for (const [k, col] of [[1, "#e2413b"], [0.7, "#f2f2f2"], [0.4, "#e2413b"], [0.15, "#f2f2f2"]] as const) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(0, 0, r * k, 0, Math.PI * 2);
      g.fill();
    }
  },
  "brand-zoom": brand("ZOOMA", "#ffc933", "#111"),
  "brand-turbo": brand("TURBOX", "#111", "#ff7a1a"),
  "brand-pit": brand("PITBOX", "#2f7de1", "#fff"),
  "brand-gear": brand("GEARHEAD", "#f2f2f2", "#d7263d"),
};
