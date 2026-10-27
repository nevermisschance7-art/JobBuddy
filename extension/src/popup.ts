import { api, APP_URL, getSession, setSession, signIn, SignedOutError } from "./api";

// Popup: sign in with your JobBuddy username, then today's matches and the next thing to do.

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
  plain: ["Ready when you are.", "Here's where things stand.", "Check, edit, submit."],
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function signedOutView(error = ""): void {
  root.innerHTML = `
    <p>Sign in with the same username you use on the JobBuddy website.</p>
    <form id="f">
      <label for="u">Username</label>
      <input id="u" name="u" autocomplete="username" required minlength="3" maxlength="30">
      <button type="submit">Sign in</button>
    </form>
    <p class="err">${esc(error)}</p>
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

async function show(): Promise<void> {
  const session = await getSession();
  if (!session) return signedOutView();
  root.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const s = await api<Summary>("summary");
    const lines = LINES[s.tone] ?? LINES.kind;
    const line = lines[new Date().getDate() % lines.length] ?? "";
    const next =
      s.toReview > 0
        ? `<a href="${APP_URL}/applications" target="_blank">Review ${s.toReview} prepared application${s.toReview === 1 ? "" : "s"}</a>`
        : s.newMatches > 0
          ? `<a href="${APP_URL}/app" target="_blank">Look at today's matches</a>`
          : `<a href="${APP_URL}/app" target="_blank">Open your job board</a>`;
    root.innerHTML = `
      <div class="mascot"><span aria-hidden="true">🐱</span><p>${esc(line)}</p></div>
      <p class="big">${s.newMatches}</p>
      <p class="muted">new matches in the last 24 hours</p>
      <p><b>Next:</b> ${next}</p>
      <p class="muted">On an application page, the JobBuddy box fills the form. You always press Submit yourself.</p>
      <p class="muted">Signed in as ${esc(session.username)} · <a href="#" id="out">Sign out</a></p>`;
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
