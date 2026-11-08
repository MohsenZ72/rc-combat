import {
  BODIES,
  FINISHES,
  MAX_STICKERS,
  PAINTS,
  RIM_COLORS,
  RIMS,
  STICKER_SLOTS,
  STICKERS,
  TYRES,
  type Cosmetics,
  type StickerId,
  type StickerSlot,
} from "@rc/shared";
import { BODY_DEFS } from "../render/car/bodies.js";
import { STICKER_ART } from "../render/car/livery.js";
import { clear, h } from "./dom.js";
import type { Screen } from "./screens.js";

type Tab = "body" | "paint" | "wheels" | "stickers" | "number";

const LABELS: Record<string, string> = {
  five: "5-spoke", six: "6-spoke", multi: "Multi", mesh: "Mesh", dish: "Dish", turbine: "Turbine", beadlock: "Beadlock", wire: "Wire",
  low: "Low profile", standard: "Standard", offroad: "Off-road", whitewall: "Whitewall",
  gloss: "Gloss", metallic: "Metallic", matte: "Matte", pearl: "Pearl",
  hood: "Bonnet", roof: "Roof", doorL: "Left door", doorR: "Right door", rear: "Rear",
};
const label = (id: string) => LABELS[id] ?? id.replace(/^brand-/, "").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Garage: edit the visual loadout while the 3D car turns on a turntable.
 * Everything here is cosmetic; the server re-validates and every car keeps
 * identical stats.
 */
export class GarageScreen implements Screen {
  readonly el: HTMLElement;
  private draft: Cosmetics;
  private tab: Tab = "body";
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly status: HTMLParagraphElement;
  private readonly saveBtn: HTMLButtonElement;

  constructor(
    initial: Cosmetics,
    private readonly onPreview: (c: Cosmetics) => void,
    private readonly onSave: (c: Cosmetics) => Promise<void>,
    private readonly onClose: () => void,
  ) {
    this.draft = structuredClone(initial);
    this.body = h("div", { class: "garage__body" });
    this.tabs = h("div", { class: "garage__tabs", role: "tablist" });
    this.status = h("p", { class: "rc-muted", "aria-live": "polite" });
    this.saveBtn = h("button", { class: "btn btn--primary", type: "button", onclick: () => void this.save() }, "Save car");
    this.el = h(
      "section",
      { class: "screen screen--garage", "aria-label": "Garage" },
      h(
        "div",
        { class: "panel garage" },
        h("h2", { class: "rc-title" }, "Garage"),
        h("p", { class: "rc-muted" }, "Looks only — every car has the same speed, grip and hitbox."),
        this.tabs,
        this.body,
        this.status,
        h("div", { class: "row" }, this.saveBtn, h("button", { class: "btn btn--ghost", type: "button", onclick: () => this.onClose() }, "Back")),
      ),
    );
    this.renderTabs();
    this.renderBody();
    this.onPreview(this.draft);
  }

  focusTarget() {
    return this.tabs.querySelector<HTMLButtonElement>("button[aria-selected=true]");
  }

  private change(mutate: (c: Cosmetics) => void): void {
    mutate(this.draft);
    this.onPreview(this.draft);
    this.renderBody();
    this.status.textContent = "Unsaved changes";
  }

  private async save(): Promise<void> {
    this.saveBtn.disabled = true;
    try {
      await this.onSave(this.draft);
      this.status.textContent = "Saved — other racers will see this car.";
    } catch (err) {
      this.status.textContent = `Could not save: ${(err as Error).message}`;
    } finally {
      this.saveBtn.disabled = false;
    }
  }

  private renderTabs(): void {
    clear(this.tabs);
    const tabs: [Tab, string][] = [["body", "Body"], ["paint", "Paint"], ["wheels", "Wheels"], ["stickers", "Stickers"], ["number", "Number"]];
    for (const [id, text] of tabs) {
      this.tabs.append(
        h("button", {
          type: "button",
          role: "tab",
          class: "chip",
          "aria-selected": String(this.tab === id),
          onclick: () => {
            this.tab = id;
            this.renderTabs();
            this.renderBody();
          },
        }, text),
      );
    }
  }

  private options<T extends string>(title: string, values: readonly T[], current: T, pick: (v: T) => void, text: (v: T) => string = label): HTMLElement {
    return h(
      "div",
      { class: "garage__group" },
      h("h3", {}, title),
      h(
        "div",
        { class: "options" },
        ...values.map((v) =>
          h("button", { type: "button", class: "option", "aria-pressed": String(v === current), onclick: () => this.change(() => pick(v)) }, text(v)),
        ),
      ),
    );
  }

  private swatches(title: string, current: string, pick: (hex: (typeof PAINTS)[number]) => void): HTMLElement {
    return h(
      "div",
      { class: "garage__group" },
      h("h3", {}, title),
      h(
        "div",
        { class: "swatches" },
        ...PAINTS.map((hex) =>
          h("button", { type: "button", class: "swatch-btn", style: `background:${hex}`, "aria-label": hex, "aria-pressed": String(hex === current), onclick: () => this.change(() => pick(hex)) }),
        ),
      ),
    );
  }

  private renderBody(): void {
    clear(this.body);
    const c = this.draft;
    switch (this.tab) {
      case "body":
        this.body.append(this.options("Body style", BODIES, c.body, (v) => (c.body = v), (v) => BODY_DEFS[v].label));
        break;
      case "paint":
        this.body.append(
          this.swatches("Main colour", c.paint, (v) => (c.paint = v)),
          this.swatches("Accent (stripes, roundel, cage)", c.accent, (v) => (c.accent = v)),
          this.options("Finish", FINISHES, c.finish, (v) => (c.finish = v)),
        );
        break;
      case "wheels":
        this.body.append(
          this.options("Rims", RIMS, c.rims, (v) => (c.rims = v)),
          this.options("Rim colour", RIM_COLORS, c.rimColor, (v) => (c.rimColor = v)),
          this.options("Tyres", TYRES, c.tyres, (v) => (c.tyres = v)),
        );
        break;
      case "stickers":
        for (const slot of STICKER_SLOTS) this.body.append(this.stickerRow(slot));
        this.body.append(h("p", { class: "rc-muted" }, `Up to ${MAX_STICKERS} stickers, one per spot.`));
        break;
      case "number": {
        const input = h("input", { class: "input", type: "number", min: 0, max: 99, value: c.number, "aria-label": "Race number (0 hides it)" });
        input.addEventListener("change", () => {
          const n = Math.max(0, Math.min(99, Math.round(Number(input.value) || 0)));
          this.change(() => (c.number = n));
        });
        this.body.append(h("div", { class: "garage__group" }, h("h3", {}, "Race number (0 = none)"), input));
        break;
      }
    }
  }

  private stickerRow(slot: StickerSlot): HTMLElement {
    const current = this.draft.stickers.find((s) => s.slot === slot)?.id ?? null;
    const set = (id: StickerId | null) =>
      this.change((c) => {
        c.stickers = c.stickers.filter((s) => s.slot !== slot);
        if (id) c.stickers.push({ id, slot });
      });
    return h(
      "div",
      { class: "garage__group" },
      h("h3", {}, label(slot)),
      h(
        "div",
        { class: "stickers" },
        h("button", { type: "button", class: "sticker-btn", "aria-pressed": String(current === null), onclick: () => set(null) }, "None"),
        ...STICKERS.map((id) => {
          const btn = h("button", { type: "button", class: "sticker-btn", title: label(id), "aria-label": label(id), "aria-pressed": String(current === id), onclick: () => set(id) });
          btn.append(stickerPreview(id, this.draft.accent));
          return btn;
        }),
      ),
    );
  }
}

function stickerPreview(id: StickerId, accent: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 56;
  canvas.height = 56;
  const g = canvas.getContext("2d");
  if (g) {
    g.translate(28, 28);
    STICKER_ART[id](g, 18, accent);
  }
  return canvas;
}
