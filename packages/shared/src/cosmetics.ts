import { z } from "zod";

/**
 * Car cosmetics. Purely visual: every body has the same collision shape and
 * stats on the server. The server only accepts ids from these lists, so a
 * client can never smuggle in anything that changes gameplay.
 */

export const BODIES = ["supercar", "muscle", "rally", "suv", "pickup", "van", "sedan", "buggy"] as const;
export const RIMS = ["five", "six", "multi", "mesh", "dish", "turbine", "beadlock", "wire"] as const;
export const RIM_COLORS = ["chrome", "black", "gold", "gunmetal", "white", "red"] as const;
export const TYRES = ["low", "standard", "offroad", "whitewall"] as const;
export const FINISHES = ["gloss", "metallic", "matte", "pearl"] as const;
export const STICKERS = [
  "flames", "bolt", "star", "checker", "stripes", "tribal", "heart", "crown",
  "paw", "rocket", "eyes", "wings", "sun", "wave", "skull", "clover",
  "dice", "comet", "diamond", "target", "brand-zoom", "brand-turbo", "brand-pit", "brand-gear",
] as const;
export const STICKER_SLOTS = ["hood", "roof", "doorL", "doorR", "rear"] as const;
export const PAINTS = [
  "#e2413b", "#ff7a1a", "#ffc933", "#3ddc84", "#1f9d55", "#26d7d7", "#2f7de1", "#1e2b9e",
  "#8a5cff", "#ff6fb5", "#f2f2f2", "#9aa3b0", "#2a2f36", "#7a4a2a", "#c0a062", "#b0e0ff",
] as const;

export type BodyId = (typeof BODIES)[number];
export type RimId = (typeof RIMS)[number];
export type RimColor = (typeof RIM_COLORS)[number];
export type TyreId = (typeof TYRES)[number];
export type Finish = (typeof FINISHES)[number];
export type StickerId = (typeof STICKERS)[number];
export type StickerSlot = (typeof STICKER_SLOTS)[number];

export const MAX_STICKERS = 5;

export const cosmeticsSchema = z
  .object({
    body: z.enum(BODIES),
    paint: z.enum(PAINTS),
    accent: z.enum(PAINTS),
    finish: z.enum(FINISHES),
    rims: z.enum(RIMS),
    rimColor: z.enum(RIM_COLORS),
    tyres: z.enum(TYRES),
    number: z.number().int().min(0).max(99),
    stickers: z
      .array(z.object({ id: z.enum(STICKERS), slot: z.enum(STICKER_SLOTS) }))
      .max(MAX_STICKERS)
      .refine((list) => new Set(list.map((s) => s.slot)).size === list.length, "one sticker per slot"),
  })
  .strict();

export type Cosmetics = z.infer<typeof cosmeticsSchema>;

export const DEFAULT_COSMETICS: Cosmetics = {
  body: "supercar",
  paint: "#e2413b",
  accent: "#f2f2f2",
  finish: "gloss",
  rims: "five",
  rimColor: "chrome",
  tyres: "standard",
  number: 7,
  stickers: [{ id: "stripes", slot: "roof" }],
};

/** Parses untrusted cosmetics; anything invalid falls back to the defaults. */
export function sanitizeCosmetics(input: unknown): Cosmetics {
  const parsed = cosmeticsSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_COSMETICS;
}

/** Deterministic random loadout (bots, first-time players). */
export function randomCosmetics(seed: number): Cosmetics {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  const stickerCount = Math.floor(next() * 3);
  const slots = [...STICKER_SLOTS].sort(() => next() - 0.5).slice(0, stickerCount);
  return {
    body: pick(BODIES),
    paint: pick(PAINTS),
    accent: pick(PAINTS),
    finish: pick(FINISHES),
    rims: pick(RIMS),
    rimColor: pick(RIM_COLORS),
    tyres: pick(TYRES),
    number: Math.floor(next() * 99) + 1,
    stickers: slots.map((slot) => ({ id: pick(STICKERS), slot })),
  };
}
