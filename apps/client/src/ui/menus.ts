import { nicknameSchema } from "@rc/shared";
import { TRACKS } from "@rc/game-core";
import type { LobbyState, ResultsMessage, SeatInfo } from "../net/connection.js";
import { clear, formatTime, h, ordinal } from "./dom.js";
import type { Screen } from "./screens.js";

const MAP_NOTES: Record<string, string> = {
  "toy-track": "orange toy track, flat & fast",
  rug: "living room, rug hills & book ramps",
  kitchen: "kitchen tiles, washer, spills",
  "toy-canyon": "kids' room, 12 m climbs & splash",
  bathroom: "bathtub, mosaic tiles, puddles",
  garden: "dirt path, lawn mounds, puddles",
  bedroom: "carpet, duvet hills, book ramps",
  workshop: "concrete, oil slicks, plank ramps",
  library: "parquet, book-stack climbs",
  sandbox: "playground dunes & paddling pool",
};

function mapNote(theme: string): string {
  return MAP_NOTES[theme] ?? "";
}

const controlsHelp = () =>
  h(
    "dl",
    { class: "help" },
    h("dt", {}, h("span", { class: "kbd" }, "W"), h("span", { class: "kbd" }, "↑")), h("dd", {}, "Throttle"),
    h("dt", {}, h("span", { class: "kbd" }, "S"), h("span", { class: "kbd" }, "↓")), h("dd", {}, "Brake / reverse"),
    h("dt", {}, h("span", { class: "kbd" }, "A"), h("span", { class: "kbd" }, "D")), h("dd", {}, "Steer"),
    h("dt", {}, h("span", { class: "kbd" }, "Space")), h("dd", {}, "Handbrake: slide into a drift, hold throttle + steer to keep it"),
    h("dt", {}, h("span", { class: "kbd" }, "Q")), h("dd", {}, "Jump: hop over shots, mines and cars"),
    h("dt", {}, h("span", { class: "kbd" }, "C")), h("dd", {}, "Look back"),
    h("dt", {}, h("span", { class: "kbd" }, "F")), h("dd", {}, "Fire zapper (ammo refills each lap)"),
    h("dt", {}, h("span", { class: "kbd" }, "E")), h("dd", {}, "Use item from a ? box"),
  );

export class TitleScreen implements Screen {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;
  private readonly error: HTMLParagraphElement;

  private track: string;

  constructor(
    nickname: string | null,
    private readonly onPlay: (nickname: string, track: string) => Promise<void>,
    track = "any",
    private readonly onGarage?: (nickname: string) => Promise<void>,
    private readonly opts: { offlineOnly?: boolean; onPractice?: (nickname: string, track: string) => Promise<void> } = {},
  ) {
    this.track = track;
    this.input = h("input", {
      class: "input",
      id: "nick",
      name: "nickname",
      maxlength: 16,
      minlength: 3,
      autocomplete: "nickname",
      placeholder: "Your racer name",
      value: nickname ?? "",
      required: true,
    });
    this.button = h("button", { class: "btn btn--primary btn--block", type: "submit" }, this.playLabel);
    const practice = opts.onPractice
      ? h("button", { class: "btn btn--ghost btn--block", type: "button", onclick: () => void this.practice() }, "Practice offline vs 9 bots")
      : null;
    this.error = h("p", { class: "error", role: "alert" });
    const form = h(
      "form",
      { class: "stack", onsubmit: (e: Event) => void this.submit(e) },
      h("div", { class: "field" }, h("label", { for: "nick" }, "Racer name"), this.input),
      this.mapPicker(),
      this.button,
      ...(practice ? [practice] : []),
      h("button", { class: "btn btn--ghost btn--block", type: "button", onclick: () => void this.openGarage() }, "Garage — customise your car"),
      this.error,
    );
    this.el = h(
      "section",
      { class: "screen screen--overlay", "aria-label": "Main menu" },
      h(
        "div",
        { class: "panel stack" },
        h("h1", { class: "rc-hero" }, "Garage", h("br"), h("span", {}, "Rumble")),
        h(
          "p",
          { class: "rc-muted" },
          opts.offlineOnly
            ? "10 diecast cars racing round the house. Race first, fight second. This web build races you against 9 bots, right in your browser."
            : "10 diecast cars racing round the house. Race first, fight second. Same car stats for everyone.",
        ),
        form,
        controlsHelp(),
      ),
    );
  }

  private get playLabel(): string {
    return this.opts.offlineOnly ? "Race 9 bots" : "Find a race";
  }

  private async practice(): Promise<void> {
    const parsed = nicknameSchema.safeParse(this.input.value);
    if (!parsed.success) {
      this.error.textContent = parsed.error.issues[0]?.message ?? "Invalid name";
      this.input.focus();
      return;
    }
    await this.opts.onPractice?.(parsed.data, this.track);
  }

  focusTarget() {
    return this.input.value ? this.button : this.input;
  }

  /** Map choice. Players are matched with others who picked the same map ("Any" is its own pool). */
  private mapPicker(): HTMLElement {
    const options = [{ id: "any", name: "Any map", note: "fastest match" }, ...Object.values(TRACKS).map((t) => ({ id: t.id, name: t.name, note: mapNote(t.theme) }))];
    return h(
      "fieldset",
      { class: "maps" },
      h("legend", {}, "Map"),
      ...options.map((o) =>
        h(
          "label",
          { class: "map-option" },
          h("input", {
            type: "radio",
            name: "map",
            value: o.id,
            checked: o.id === this.track,
            onchange: () => {
              this.track = o.id;
            },
          }),
          h("span", { class: "map-name" }, o.name),
          h("span", { class: "map-note" }, o.note),
        ),
      ),
    );
  }

  private async openGarage(): Promise<void> {
    const parsed = nicknameSchema.safeParse(this.input.value);
    if (!parsed.success) {
      this.error.textContent = "Pick a racer name first — your car is saved to it.";
      this.input.focus();
      return;
    }
    try {
      await this.onGarage?.(parsed.data);
    } catch (err) {
      this.error.textContent = (err as Error).message || "Could not open the garage.";
    }
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    const parsed = nicknameSchema.safeParse(this.input.value);
    if (!parsed.success) {
      this.error.textContent = parsed.error.issues[0]?.message ?? "Invalid name";
      this.input.focus();
      return;
    }
    this.button.disabled = true;
    this.button.textContent = this.opts.offlineOnly ? "Starting…" : "Connecting…";
    this.error.textContent = "";
    try {
      await this.onPlay(parsed.data, this.track);
    } catch (err) {
      this.error.textContent = (err as Error).message || "Could not connect. Is the server running?";
      this.button.disabled = false;
      this.button.textContent = this.playLabel;
    }
  }
}

export class LobbyScreen implements Screen {
  readonly el: HTMLElement;
  private readonly roster: HTMLUListElement;
  private readonly status: HTMLParagraphElement;
  private readonly leave: HTMLButtonElement;
  private timer = 0;
  private lobby: LobbyState | null = null;

  constructor(onLeave: () => void) {
    this.roster = h("ul", { class: "roster", "aria-label": "Racers" });
    this.status = h("p", { class: "rc-muted", "aria-live": "polite" }, "Joining…");
    this.leave = h("button", { class: "btn btn--ghost", type: "button", onclick: onLeave }, "Leave");
    this.el = h(
      "section",
      { class: "screen screen--overlay", "aria-label": "Lobby" },
      h("div", { class: "panel panel--wide stack" }, h("h2", { class: "rc-title" }, "Pit lane"), this.status, this.roster, h("div", { class: "row" }, this.leave)),
    );
  }

  focusTarget() {
    return this.leave;
  }

  onShow() {
    this.timer = window.setInterval(() => this.renderStatus(), 250);
  }

  onHide() {
    window.clearInterval(this.timer);
  }

  update(lobby: LobbyState): void {
    this.lobby = lobby;
    clear(this.roster);
    for (let i = 0; i < lobby.maxPlayers; i++) {
      const p: SeatInfo | undefined = lobby.players.find((x) => x.slot === i);
      this.roster.append(
        p
          ? h("li", {}, h("span", { class: "swatch", style: `background:${p.color}` }), `${p.nickname}${p.isBot ? " (bot)" : ""}`)
          : h("li", { class: "is-empty" }, "Open seat"),
      );
    }
    this.renderStatus();
  }

  private renderStatus(): void {
    const l = this.lobby;
    if (!l) return;
    const humans = l.players.filter((p) => !p.isBot).length;
    if (l.lobbyEndsAt > 0) {
      const s = Math.max(0, Math.ceil((l.lobbyEndsAt - Date.now()) / 1000));
      this.status.textContent = `${humans}/${l.maxPlayers} racers · starting in ${s}s (empty seats get bots)`;
    } else {
      this.status.textContent = `${humans}/${l.maxPlayers} racers · waiting for ${Math.max(0, l.minPlayers - humans)} more`;
    }
  }
}

export class ResultsScreen implements Screen {
  readonly el: HTMLElement;
  private readonly again: HTMLButtonElement;

  constructor(results: ResultsMessage, mySlot: number, onAgain: () => void, onMenu: () => void) {
    this.again = h("button", { class: "btn btn--primary", type: "button", onclick: onAgain }, "Race again");
    const me = results.results.find((r) => r.slot === mySlot);
    const rows = results.results.map((r) =>
      h(
        "tr",
        { class: r.slot === mySlot ? "is-me" : "" },
        h("td", { class: "rank" }, r.status === "finished" ? ordinal(r.rank) : "—"),
        h("td", {}, `${r.nickname}${r.isBot ? " (bot)" : ""}`),
        h("td", { class: "rc-mono" }, r.status === "finished" ? formatTime(r.finishTimeMs) : r.status === "forfeit" ? "left" : `DNF · ${r.lapsCompleted} laps`),
        h("td", {}, r.isBot ? h("span", { class: "badge badge--muted" }, "bot") : r.verified ? h("span", { class: "badge badge--go" }, "✓ verified") : h("span", { class: "badge badge--warn" }, "under review")),
      ),
    );
    const headline =
      results.status === "abandoned" ? "Race abandoned" : me ? (me.status === "finished" ? `You finished ${ordinal(me.rank)}` : "Race over") : "Results";
    this.el = h(
      "section",
      { class: "screen screen--overlay", "aria-label": "Results" },
      h(
        "div",
        { class: "panel panel--wide stack" },
        h("h2", { class: "rc-title" }, headline),
        h("p", { class: "rc-muted" }, "Ranks and times are computed and verified by the server."),
        h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, "Pos"), h("th", {}, "Racer"), h("th", {}, "Time"), h("th", {}, "Result"))), h("tbody", {}, ...rows)),
        h("div", { class: "row" }, this.again, h("button", { class: "btn btn--ghost", type: "button", onclick: onMenu }, "Main menu")),
      ),
    );
  }

  focusTarget() {
    return this.again;
  }
}

export class NoticeScreen implements Screen {
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;
  constructor(title: string, body: string, action: string, onAction: () => void) {
    this.button = h("button", { class: "btn btn--primary", type: "button", onclick: onAction }, action);
    this.el = h("section", { class: "screen screen--overlay", role: "alertdialog", "aria-label": title }, h("div", { class: "panel stack" }, h("h2", { class: "rc-title" }, title), h("p", {}, body), this.button));
  }
  focusTarget() {
    return this.button;
  }
}
