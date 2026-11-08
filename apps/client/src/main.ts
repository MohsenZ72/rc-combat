import "./styles/tokens.css";
import "./styles/ui.css";
import { checkSession, fetchCosmetics, guestLogin, loadSession, saveCosmetics, type Session } from "./net/api.js";
import { GarageScreen } from "./ui/garage.js";
import { Phase, sanitizeCosmetics, type Cosmetics } from "@rc/shared";
import type { RaceClient } from "./game/race-client.js";
import { HudScreen } from "./ui/hud.js";
import { LobbyScreen, NoticeScreen, ResultsScreen, TitleScreen } from "./ui/menus.js";
import { ScreenStack } from "./ui/screens.js";

const ui = document.getElementById("ui")!;
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const screens = new ScreenStack(ui);
let session: Session | null = loadSession();
let client: RaceClient | null = null;

/**
 * Static build (GitHub Pages): no API or game server exists, so every race
 * runs offline in the browser against bots and the car is stored locally.
 */
const OFFLINE_ONLY = import.meta.env.VITE_OFFLINE_ONLY === "1";
const LOCAL_CAR = "rc.cosmetics";
const LOCAL_NAME = "rc.nickname";

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the car simply isn't remembered
  }
}

function localCosmetics(): Cosmetics {
  const raw = storageGet(LOCAL_CAR);
  try {
    return sanitizeCosmetics(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeCosmetics(null);
  }
}

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
  const name = OFFLINE_ONLY ? storageGet(LOCAL_NAME) : (session?.player.nickname ?? storageGet(LOCAL_NAME));
  screens.reset(new TitleScreen(name, play, lastTrack, openGarage, { offlineOnly: OFFLINE_ONLY, onPractice: OFFLINE_ONLY ? undefined : practice }));
}

let lastTrack = "any";

async function ensureSession(nickname: string): Promise<Session> {
  if (!session || session.player.nickname !== nickname || !(await checkSession(session))) {
    session = await guestLogin(nickname);
  }
  return session;
}

async function openGarage(nickname: string): Promise<void> {
  storageSet(LOCAL_NAME, nickname);
  const s = OFFLINE_ONLY ? null : await ensureSession(nickname);
  const rc = await getClient();
  const current = s ? await fetchCosmetics(s) : localCosmetics();
  screens.reset(
    new GarageScreen(
      current,
      (c) => rc.showGarage(c),
      async (c) => {
        storageSet(LOCAL_CAR, JSON.stringify(c));
        if (s) await saveCosmetics(s, c);
      },
      () => {
        rc.closeGarage();
        showTitle();
      },
    ),
  );
}

/** Offline race against bots from the online build's menu. */
function practice(nickname: string, track = lastTrack): Promise<void> {
  return play(nickname, track, true);
}

async function play(nickname: string, track = lastTrack, offline = OFFLINE_ONLY): Promise<void> {
  lastTrack = track;
  storageSet(LOCAL_NAME, nickname);
  const s = offline ? null : await ensureSession(nickname);
  const rc = await getClient();
  rc.closeGarage();
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
        () => void play(nickname, track, offline).catch(() => showTitle()),
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
    if (s) await rc.join(s.token, track);
    else await rc.join("", track, { nickname, cosmetics: localCosmetics() });
  } catch (err) {
    showTitle();
    throw err;
  }
}

showTitle();
