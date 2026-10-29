import { alertMessage, type AlertEvent } from "@jobbuddy/shared";
import { api, APP_URL, getSession, setSession, signIn, SignedOutError } from "./api";

// Popup: sign in with your JobBuddy username; then today's numbers, unread alerts (opening the
// popup marks them read and clears the badge), "Fill this page" for any application form, and
// links into the app.

type Summary = {
  username: string | null;
  tone: "kind" | "funny" | "plain";
  newMatches: number;
  toReview: number;
};

const root = document.getElementById("root")!;

const LINES: Record<Summary["tone"], string[]> = {
  kind: [
    "One application at a time. You're doing fine.",
    "Small steps count. Take a break when you need one.",
    "Every no gets you closer to a yes.",
  ],
  funny: [
    "I sorted the jobs. You do the charming bit.",
    "Recruiters are typing... probably.",
    "Coffee first, applications second.",
  ],
  plain: ["Ready when you are.", "Here's where things stand.", "Check, fill, submit."],
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function signedOutView(error = ""): void {
  root.innerHTML = `
    <p class="lead">Sign in with the same username you use on the JobBuddy website.</p>
    <form id="f">
      <label for="u">Username</label>
      <input id="u" name="u" autocomplete="username" required minlength="3" maxlength="30">
      <button type="submit" class="primary">Sign in</button>
    </form>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <p class="muted">New here? <a href="${APP_URL}/login" target="_blank">Sign up on the website</a> first.</p>`;
  const form = document.getElementById("f") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button")!;
    button.disabled = true;
    button.textContent = "Signing in...";
    try {
      await signIn((document.getElementById("u") as HTMLInputElement).value);
      await show();
    } catch (err) {
      signedOutView(err instanceof Error ? err.message : "Could not sign you in.");
    }
  });
}

/** Loads the filler into the current tab (any site, thanks to activeTab) and opens its box. */
async function fillThisPage(): Promise<void> {
  const status = document.getElementById("fill-status")!;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
    status.textContent = "Open an application form first, then press this again.";
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "fill-here" });
    window.close();
  } catch {
    status.textContent = "I can't work on this page. Try the application form itself.";
  }
}

async function show(): Promise<void> {
  const session = await getSession();
  if (!session) return signedOutView();
  root.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const [s, { events }] = await Promise.all([
      api<Summary>("summary"),
      api<{ events: AlertEvent[] }>(
        `events?since=${encodeURIComponent(new Date(0).toISOString())}`,
      ),
    ]);
    const recent = events.slice(-4).reverse();
    const alerts = recent.length
      ? `<div class="alerts">${recent
          .map((e) => {
            const { title, message } = alertMessage(e, s.tone);
            return `<p><b>${esc(title)}</b>${esc(message)}</p>`;
          })
          .join("")}</div>`
      : "";
    if (events.length) {
      // Seen now: mark every unread alert read so the number on the icon goes away.
      await chrome.action.setBadgeText({ text: "" });
      void api("events", { method: "POST", body: { all: true } }).catch(() => {});
    }
    const lines = LINES[s.tone] ?? LINES.kind;
    const line = lines[new Date().getDate() % lines.length] ?? "";
    root.innerHTML = `
      <div class="stats">
        <a class="stat" href="${APP_URL}/app" target="_blank"><b>${s.newMatches}</b><span>new matches (24 h)</span></a>
        <a class="stat" href="${APP_URL}/applications" target="_blank"><b>${s.toReview}</b><span>ready to apply</span></a>
      </div>
      ${alerts}
      <button id="fill" class="primary">⚡ Fill this page</button>
      <p id="fill-status" class="muted center">Works on any application form. You always press Submit.</p>
      <div class="links">
        <a href="${APP_URL}/app" target="_blank">Find jobs</a>
        <a href="${APP_URL}/applications" target="_blank">Applications</a>
        <a href="${APP_URL}/settings" target="_blank">Settings</a>
      </div>
      <div class="mascot"><span aria-hidden="true">🐱</span><p>${esc(line)}</p></div>
      <p class="muted foot">Signed in as <b>${esc(session.username)}</b> · <a href="#" id="out">Sign out</a></p>`;
    document.getElementById("fill")!.addEventListener("click", () => void fillThisPage());
    document.getElementById("out")!.addEventListener("click", async (e) => {
      e.preventDefault();
      await setSession(null);
      await chrome.action.setBadgeText({ text: "" });
      signedOutView();
    });
  } catch (err) {
    if (err instanceof SignedOutError) signedOutView("Please sign in again.");
    else
      root.innerHTML = `<p class="err">${esc(err instanceof Error ? err.message : "Couldn't reach JobBuddy.")}</p>`;
  }
}

void show();
