// Talks to the JobBuddy web app. Only the background service worker and the popup use this:
// they have host permission for the app, so no CORS. Content scripts ask the background.

export const APP_URL = (import.meta.env.VITE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type Session = {
  access_token: string;
  refresh_token: string;
  /** Seconds since epoch. */
  expires_at: number;
  username: string;
};

const KEY = "session";

export async function getSession(): Promise<Session | null> {
  const { [KEY]: s } = await chrome.storage.local.get(KEY);
  return (s as Session | undefined) ?? null;
}

export async function setSession(s: Session | null): Promise<void> {
  if (s) await chrome.storage.local.set({ [KEY]: s });
  else await chrome.storage.local.remove(KEY);
}

export class SignedOutError extends Error {
  constructor() {
    super("Sign in again in the JobBuddy extension.");
  }
}

export async function signIn(username: string): Promise<Session> {
  const res = await fetch(`${APP_URL}/api/extension/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not sign you in.");
  const session = json as Session;
  await setSession(session);
  return session;
}

async function freshSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new SignedOutError();
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  const res = await fetch(`${APP_URL}/api/extension/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) {
    await setSession(null);
    throw new SignedOutError();
  }
  const next = { ...s, ...((await res.json()) as Omit<Session, "username">) };
  await setSession(next);
  return next;
}

/** JSON request to /api/extension/<path> as the signed-in user. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const s = await freshSession();
  const res = await fetch(`${APP_URL}/api/extension/${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${s.access_token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) {
    await setSession(null);
    throw new SignedOutError();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}
