import { ITEM_NAMES, ItemKind } from "@rc/shared";
import type { Track } from "@rc/game-core";
import { formatTime, h } from "./dom.js";
import type { Screen } from "./screens.js";

export interface HudState {
  rank: number;
  total: number;
  lap: number;
  laps: number;
  hp: number;
  maxHp: number;
  item: ItemKind;
  itemLocked: boolean;
  ammo: number;
  maxAmmo: number;
  shield: boolean;
  turbo: boolean;
  emp: boolean;
  wrongWay: boolean;
}

const ITEM_ICONS: Record<ItemKind, string> = {
  [ItemKind.None]: "",
  [ItemKind.Rocket]: "🚀",
  [ItemKind.Mine]: "💣",
  [ItemKind.Shield]: "🛡️",
  [ItemKind.Turbo]: "⚡",
  [ItemKind.Emp]: "📡",
  [ItemKind.Repair]: "🔧",
};

/** In-race HUD. Updated through explicit calls driven by snapshots/events, never by polling. */
export class HudScreen implements Screen {
  readonly el: HTMLElement;
  readonly tags: HTMLElement;
  private readonly pos = h("div", { class: "position", "aria-live": "polite" });
  private readonly lap = h("div", { class: "lap" });
  private readonly timer = h("div", { class: "timer rc-mono" }, "00:00.000");
  private readonly meterFill = h("div", { class: "meter__fill" });
  private readonly meter = h("div", { class: "meter", role: "meter", "aria-label": "Health" }, this.meterFill);
  private readonly hpText = h("span", {}, "100");
  private readonly pips = h("div", { class: "pips", "aria-label": "Ammo" });
  private readonly status = h("div", { class: "status-row" });
  private readonly itemIcon = h("div", { class: "item-slot__icon" });
  private readonly itemName = h("div", { class: "item-slot__name" }, "No item");
  private readonly itemSlot = h("div", { class: "item-slot" }, this.itemIcon, h("div", {}, this.itemName, h("div", { class: "rc-muted" }, h("span", { class: "kbd" }, "E"), " use")));
  private readonly callout = h("div", { class: "callout", "aria-live": "assertive" });
  private readonly feed = h("ul", { class: "feed" });
  private readonly minimap: HTMLCanvasElement;
  private readonly mapBase: HTMLCanvasElement;
  private mapTransform = { s: 1, ox: 0, oy: 0 };
  private calloutTimer = 0;
  private last: HudState | null = null;

  constructor(track: Track) {
    this.minimap = h("canvas", { class: "minimap", width: 220, height: 220, "aria-hidden": "true" });
    this.mapBase = document.createElement("canvas");
    this.tags = h("div", { "aria-hidden": "true" });
    this.el = h(
      "section",
      { class: "screen screen--hud", "aria-label": "Race HUD" },
      this.tags,
      h(
        "div",
        { class: "hud" },
        h("div", { class: "hud__tl" }, this.pos, this.lap),
        h("div", { class: "hud__tr" }, this.timer, this.minimap),
        h("div", { class: "hud__mc" }, this.callout),
        h("div", { class: "hud__mr" }, this.feed),
        h("div", { class: "hud__bl" }, h("div", { class: "meter-label" }, h("span", {}, "HP"), this.hpText), this.meter, this.pips, this.status),
        h("div", { class: "hud__bc" }, this.itemSlot),
      ),
    );
    this.drawMapBase(track);
  }

  update(s: HudState): void {
    const prev = this.last;
    if (!prev || prev.rank !== s.rank || prev.total !== s.total) {
      this.pos.replaceChildren(`${s.rank}`, h("small", {}, `/${s.total}`));
    }
    if (!prev || prev.lap !== s.lap) this.lap.textContent = `Lap ${Math.max(1, Math.min(s.lap, s.laps))}/${s.laps}`;
    if (!prev || prev.hp !== s.hp) {
      const f = Math.max(0, s.hp / s.maxHp);
      this.meterFill.style.transform = `scaleX(${f})`;
      this.meter.classList.toggle("is-low", f < 0.35);
      this.meter.setAttribute("aria-valuenow", String(s.hp));
      this.hpText.textContent = String(Math.round(s.hp));
    }
    if (!prev || prev.ammo !== s.ammo) {
      this.pips.replaceChildren(...Array.from({ length: s.maxAmmo }, (_, i) => h("i", { class: i < s.ammo ? "" : "is-spent" })));
    }
    if (!prev || prev.item !== s.item || prev.itemLocked !== s.itemLocked) {
      this.itemIcon.textContent = ITEM_ICONS[s.item];
      this.itemName.textContent = s.item === ItemKind.None ? "No item" : ITEM_NAMES[s.item];
      this.itemSlot.classList.toggle("has-item", s.item !== ItemKind.None);
      this.itemSlot.classList.toggle("is-locked", s.itemLocked);
    }
    if (!prev || prev.shield !== s.shield || prev.turbo !== s.turbo || prev.emp !== s.emp) {
      this.status.replaceChildren(
        ...[s.shield && h("span", { class: "badge badge--go" }, "Shield"), s.turbo && h("span", { class: "badge badge--warn" }, "Turbo"), s.emp && h("span", { class: "badge badge--warn" }, "EMP!")].filter(
          (x): x is HTMLSpanElement => Boolean(x),
        ),
      );
    }
    if (s.wrongWay && !prev?.wrongWay) this.show("Wrong way", "is-warn", 0);
    else if (!s.wrongWay && prev?.wrongWay) this.callout.textContent = "";
    this.last = s;
  }

  setTimer(ms: number): void {
    this.timer.textContent = formatTime(ms);
  }

  /** Big centre text (countdown, GO, finish). `ms` 0 = until replaced. */
  show(text: string, kind = "", ms = 900): void {
    window.clearTimeout(this.calloutTimer);
    this.callout.className = `callout is-pop ${kind}`;
    this.callout.textContent = text;
    if (ms > 0) this.calloutTimer = window.setTimeout(() => (this.callout.textContent = ""), ms);
  }

  pushFeed(text: string, info = false): void {
    const li = h("li", { class: info ? "is-info" : "" }, text);
    this.feed.prepend(li);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => li.remove(), 5000);
  }

  drawMap(cars: { x: number; y: number; color: string; me: boolean }[]): void {
    const ctx = this.minimap.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.minimap.width, this.minimap.height);
    ctx.drawImage(this.mapBase, 0, 0);
    const { s, ox, oy } = this.mapTransform;
    for (const c of cars) {
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oy - c.y * s, c.me ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      if (c.me) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }
  }

  private drawMapBase(track: Track): void {
    const size = 220;
    this.mapBase.width = size;
    this.mapBase.height = size;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.xs[i]!); maxX = Math.max(maxX, track.xs[i]!);
      minY = Math.min(minY, track.ys[i]!); maxY = Math.max(maxY, track.ys[i]!);
    }
    const pad = 16;
    const s = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
    // Screen y grows downwards; flip so the map matches the top-down world view.
    const ox = pad - minX * s + ((size - pad * 2) - (maxX - minX) * s) / 2;
    const oy = size - pad + minY * s - ((size - pad * 2) - (maxY - minY) * s) / 2;
    this.mapTransform = { s, ox, oy };
    const ctx = this.mapBase.getContext("2d")!;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= track.count; i++) {
      const j = i % track.count;
      const x = ox + track.xs[j]! * s;
      const y = oy - track.ys[j]! * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#3a4352";
    ctx.lineWidth = Math.max(4, track.def.width * s);
    ctx.stroke();
    const g = track.gates[0]!;
    ctx.beginPath();
    ctx.moveTo(ox + g.ax * s, oy - g.ay * s);
    ctx.lineTo(ox + g.bx * s, oy - g.by * s);
    ctx.strokeStyle = "#ffc933";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
