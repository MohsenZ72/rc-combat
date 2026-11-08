import "./styles/tokens.css";
import "./styles/ui.css";
import { checkSession, guestLogin, loadSession, type Session } from "./net/api.js";
import { Phase } from "@rc/shared";
import type { RaceClient } from "./game/race-client.js";
import { HudScreen } from "./ui/hud.js";
import { LobbyScreen, NoticeScreen, ResultsScreen, TitleScreen } from "./ui/menus.js";
import { ScreenStack } from "./ui/screens.js";

const ui = document.getElementById("ui")!;
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const screens = new ScreenStack(ui);
let session: Session | null = loadSession();
let client: RaceClient | null = null;

/** Close codes the server uses (see apps/game-server/src/rooms/race-room.ts). */
const CLOSE_REASONS: Record<number, string> = {
  4003: "Lost connection to the race server and could not reconnect in time.",
  4011: "You were disconnected for sending invalid data.",
  4012: "You are already racing in this match from another tab.",
};
/** Normal endings: we left (4000 CONSENTED) or the server closed a finished match (4013). */
const NORMAL_CLOSES = new Set([1000, 4000, 4013]);

async function getClient(): Promise<RaceClient> {
  // The 3D engine and physics are lazy-loaded after the menu is interactive.
  if (!client) {
    const { RaceClient } = await import("./game/race-client.js");
    client = await RaceClient.create(canvas);
    // Dev-only handle for debugging in the browser console; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __rc: RaceClient }).__rc = client;
  }
  return client;
}

function showTitle(): void {
  screens.reset(new TitleScreen(session?.player.nickname ?? null, play, lastTrack));
}

let lastTrack = "any";

async function play(nickname: string, track = lastTrack): Promise<void> {
  lastTrack = track;
  if (!session || session.player.nickname !== nickname || !(await checkSession(session))) {
    session = await guestLogin(nickname);
  }
  const rc = await getClient();
  rc.clear();
  const lobby = new LobbyScreen(() => void rc.leave().then(showTitle));
  rc.on("lobby", (l) => {
    lobby.update(l);
    // The roster locks at countdown: swap the lobby for the race HUD.
    if (l.phase >= Phase.Countdown && screens.top === lobby) {
      const hud = new HudScreen(rc.track);
      rc.attachHud(hud);
      screens.reset(hud);
    }
  });
  rc.on("results", (r) => {
    rc.attachHud(null);
    screens.reset(
      new ResultsScreen(
        r,
        rc.slot,
        () => void play(nickname, track).catch(() => showTitle()),
        () => void rc.leave().then(showTitle),
      ),
    );
  });
  rc.on("connection", (state) => {
    document.body.dataset.connection = state;
  });
  rc.on("closed", ({ code }) => {
    if (NORMAL_CLOSES.has(code)) return;
    rc.attachHud(null);
    screens.reset(new NoticeScreen("Disconnected", CLOSE_REASONS[code] ?? "Lost connection to the race server.", "Back to menu", showTitle));
  });
  screens.reset(lobby);
  try {
    await rc.join(session.token, track);
  } catch (err) {
    screens.reset(new TitleScreen(nickname, play, track));
    throw err;
  }
}

showTitle();
