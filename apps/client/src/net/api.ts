const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const TOKEN_KEY = "rc.session";

export interface Session {
  token: string;
  expiresAt: string;
  player: { id: string; nickname: string };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Remembered session (per-browser convenience; the server still validates every use). */
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return new Date(s.expiresAt).getTime() > Date.now() + 60_000 ? s : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage may be unavailable (private mode); the session just isn't remembered */
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(new URL(path, API_URL), {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] };
    throw new ApiError(body.issues?.[0]?.message ?? body.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function guestLogin(nickname: string): Promise<Session> {
  const s = await request<Session>("/auth/guest", { method: "POST", body: JSON.stringify({ nickname }) });
  saveSession(s);
  return s;
}

/** Confirms a remembered session is still live; clears it if not. */
export async function checkSession(s: Session): Promise<boolean> {
  try {
    await request("/players/me", {}, s.token);
    return true;
  } catch {
    saveSession(null);
    return false;
  }
}

export async function logout(s: Session): Promise<void> {
  saveSession(null);
  await request("/auth/logout", { method: "POST" }, s.token).catch(() => undefined);
}
