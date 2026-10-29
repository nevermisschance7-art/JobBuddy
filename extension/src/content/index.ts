import { fixedKeyFor, isFormHost, jobKeyFromUrl } from "@jobbuddy/shared";
import type { FillData, LookupResult, Message, PrepareResult, Reply } from "../types";
import {
  attachFile,
  collectFields,
  fillComboboxes,
  fillForm,
  isConfirmation,
  type FormField,
} from "./form";

// Runs on Greenhouse, Lever, Ashby, Workable and SmartRecruiters pages (also inside iframes
// embedded on company sites), and on any page when the user presses "Fill this page" in the
// popup. One button does it all: prepares the application, makes the CV, drafts answers,
// fills the form. Rule: JobBuddy never clicks Submit. The user always does.

declare global {
  interface Window {
    __jobbuddy?: boolean;
  }
}

const PENDING = "jobbuddy-pending-application";

function send<T>(message: Message): Promise<Reply<T>> {
  return chrome.runtime.sendMessage(message);
}

// ---------------------------------------------------------------- the box

let shadow: ShadowRoot | null = null;
let host: HTMLElement | null = null;

function box(): ShadowRoot {
  if (shadow && host?.isConnected) return shadow;
  host = document.createElement("div");
  host.id = "jobbuddy-box";
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: "closed" });
  return shadow;
}

const ICON = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#4f46e5"/><path d="M6 9.5h12v7.5H6zM9.5 9.5V7.5h5v2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

const STYLE = `<style>
  :host{all:initial}
  .card{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#1c1b22;border:1px solid #e4e4ec;
    border-radius:16px;box-shadow:0 12px 40px rgba(30,27,75,.18);width:300px;overflow:hidden}
  .head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #f0f0f5;background:#fafaff}
  .head b{flex:1;font-size:13px}
  .icon-btn{background:none;border:0;cursor:pointer;color:#8a8aa0;font-size:16px;line-height:1;padding:2px 4px;border-radius:6px}
  .icon-btn:hover{background:#efeff7;color:#1c1b22}
  .body{padding:12px 14px 14px}
  .job{font-weight:600;font-size:14px;margin:0}
  .sub{color:#6b6b80;font-size:12px;margin:2px 0 0}
  .pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;margin-top:6px}
  .pill.ok{background:#e7f6ee;color:#16794a}.pill.todo{background:#eef0ff;color:#4f46e5}
  button.main{margin-top:12px;width:100%;padding:10px;border:0;border-radius:10px;background:#4f46e5;color:#fff;
    font:600 13px system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
  button.main:hover{background:#4338ca} button.main:disabled{opacity:.6;cursor:default}
  button.second{margin-top:8px;width:100%;padding:8px;border:1px solid #e4e4ec;border-radius:10px;background:#fff;
    color:#1c1b22;font:500 12px system-ui,sans-serif;cursor:pointer}
  ul.steps{list-style:none;margin:4px 0 0;padding:0}
  ul.steps li{display:flex;gap:8px;align-items:center;padding:4px 0;color:#6b6b80}
  ul.steps li.done{color:#16794a}ul.steps li.now{color:#1c1b22;font-weight:600}
  .dot{width:16px;height:16px;border-radius:50%;border:2px solid #d4d4e0;flex:none;box-sizing:border-box}
  li.done .dot{border:0;background:#16a34a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' stroke='white' stroke-width='2' fill='none'/%3E%3C/svg%3E") center/12px no-repeat}
  li.now .dot{border-color:#4f46e5;border-top-color:transparent;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .row{display:flex;align-items:center;gap:8px;padding:5px 0}
  .ok{color:#16794a}.warn{color:#b45309}
  .muted{color:#6b6b80;font-size:12px;margin-top:10px}
  a{color:#4f46e5}
  .mini{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;font:600 13px system-ui,sans-serif}
</style>`;

let minimized = false;
let lastHtml = "";
let lastActions: Record<string, () => void> = {};

function render(html: string, actions: Record<string, () => void> = {}): void {
  lastHtml = html;
  lastActions = actions;
  const root = box();
  if (minimized) {
    root.innerHTML = `${STYLE}<div class="card"><div class="mini" data-act="expand">${ICON} JobBuddy</div></div>`;
  } else {
    root.innerHTML = `${STYLE}<div class="card"><div class="head">${ICON}<b>JobBuddy</b>
      <button class="icon-btn" data-act="minimize" aria-label="Minimise">–</button>
      <button class="icon-btn" data-act="close" aria-label="Close">×</button></div>
      <div class="body">${html}</div></div>`;
  }
  root.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
    const act = el.dataset.act!;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (act === "close") host?.remove();
      else if (act === "minimize" || act === "expand") {
        minimized = act === "minimize";
        render(lastHtml, lastActions);
      } else actions[act]?.();
    });
  });
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Step = { label: string; state: "todo" | "now" | "done" };

function steps(list: Step[], title: string): void {
  render(
    `<p class="job">${esc(title)}</p>
     <ul class="steps">${list.map((s) => `<li class="${s.state}"><span class="dot"></span>${esc(s.label)}</li>`).join("")}</ul>`,
  );
}

// ---------------------------------------------------------------- page facts

function pageInfo() {
  const og = (p: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="og:${p}"]`)?.content?.trim();
  const title =
    (document.querySelector("h1")?.textContent ?? og("title") ?? document.title)
      .trim()
      .slice(0, 300) || "Job";
  const slug = location.pathname.split("/").filter(Boolean)[0] ?? "";
  const company =
    (
      og("site_name") ??
      (jobKeyFromUrl(location.href)
        ? slug.replace(/[-_]+/g, " ")
        : location.hostname.replace(/^www\./, ""))
    )
      .trim()
      .slice(0, 200) || location.hostname;
  const description = (document.querySelector("main, #content, .content, body")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
  return { title, company, description };
}

function highlight(fields: FormField[]): void {
  for (const f of fields) {
    const el = target(f);
    el.style.outline = "2px solid #f59e0b";
    el.style.outlineOffset = "3px";
    el.style.borderRadius = "6px";
    el.title = "JobBuddy couldn't fill this one. Please fill it yourself.";
  }
}

function target(f: FormField): HTMLElement {
  if (f.options || f.choices) {
    const first = (f.options?.[0]?.el ?? f.choices?.[0]?.el) as HTMLElement;
    return (
      (first.closest(
        "fieldset, .application-question, .field, [role='radiogroup']",
      ) as HTMLElement | null) ??
      first.parentElement ??
      first
    );
  }
  return f.el as unknown as HTMLElement;
}

function fileFrom(cv: { fileName: string; base64: string }): File {
  const bytes = Uint8Array.from(atob(cv.base64), (c) => c.charCodeAt(0));
  return new File([bytes], cv.fileName, { type: "application/pdf" });
}

/** Free-text questions nobody has answered yet, which the AI may draft (never sensitive ones). */
function draftable(missed: FormField[]): string[] {
  return [
    ...new Set(
      missed
        .filter(
          (f) =>
            (f.kind === "question" || f.kind === "cover_letter") &&
            !f.options &&
            !f.choices &&
            !f.combobox &&
            f.el.tagName !== "SELECT" &&
            !fixedKeyFor(f.label) &&
            f.label.length > 2,
        )
        .map((f) => f.label),
    ),
  ].slice(0, 12);
}

// ---------------------------------------------------------------- the one-button flow

// ---------------------------------------------------------------- multi-page forms

// After the first fill, this tab remembers the application for a while, so the next pages of
// a multi-page form (Workday, iCIMS...) are filled with the same application automatically.
const SESSION = "jobbuddy-session";
const SESSION_MS = 2 * 3_600_000;

function session(): string | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION) ?? "null") as {
      id: string;
      at: number;
    } | null;
    return s && Date.now() - s.at < SESSION_MS ? s.id : null;
  } catch {
    return null;
  }
}

function remember(applicationId: string): void {
  sessionStorage.setItem(SESSION, JSON.stringify({ id: applicationId, at: Date.now() }));
}

/** Labels of the fields already handled on this page, to notice when a new step appears. */
const handled = new Set<string>();
let busy = false;

function newStepAppeared(): boolean {
  const fresh = collectFields(document).filter((f) => {
    if (handled.has(f.label)) return false;
    const el = f.el as unknown as HTMLInputElement;
    return f.options || f.choices || f.combobox || f.editable ? true : !el.value?.trim();
  });
  return fresh.length >= 2;
}

async function lookup(): Promise<LookupResult | null> {
  const reply = await send<LookupResult>({
    type: "lookup",
    url: location.href,
    applicationId: session() ?? undefined,
  });
  if (!reply.ok) {
    showError(reply);
    return null;
  }
  return reply.data;
}

async function run(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await runSteps();
  } finally {
    for (const f of collectFields(document)) handled.add(f.label);
    busy = false;
  }
}

async function runSteps(): Promise<void> {
  const info = pageInfo();
  const list: Step[] = [
    { label: "Getting your application ready", state: "now" },
    { label: "Making your CV for this job", state: "todo" },
    { label: "Drafting answers", state: "todo" },
    { label: "Filling the form", state: "todo" },
  ];
  const go = (i: number) => {
    list.forEach((s, j) => (s.state = j < i ? "done" : j === i ? "now" : "todo"));
    steps(list, info.title);
  };
  go(0);

  let result = await lookup();
  if (!result) return;
  const firstFill = fillForm(collectFields(document), result.application ?? result.base);
  const questions = draftable(firstFill.missed);

  // 1. The application (created now if this job isn't prepared yet).
  let applicationId = result.application?.applicationId ?? null;
  if (!applicationId) {
    const prep = await send<PrepareResult>({
      type: "prepare",
      input: { url: location.href, ...info, questions: [] },
    });
    if (!prep.ok) return showError(prep);
    applicationId = prep.data.applicationId;
  }
  remember(applicationId);

  // 2 and 3. CV and answers at the same time (two separate requests).
  go(1);
  const needsCv = !result.application?.cv;
  const [cv, drafts] = await Promise.all([
    needsCv ? send<{ note: string | null }>({ type: "cv", applicationId }) : Promise.resolve(null),
    questions.length > 0
      ? send<PrepareResult>({
          type: "prepare",
          input: { url: location.href, ...info, questions, applicationId },
        })
      : Promise.resolve(null),
  ]);
  go(2);
  const cvError = cv && !cv.ok ? cv.error : null;
  const draftError = drafts && !drafts.ok ? drafts.error : null;

  // 4. Fill with everything.
  go(3);
  result = await lookup();
  if (!result?.application) return;
  await fill(result, { cvError, draftError, note: cv?.ok ? cv.data.note : null });
}

async function fill(
  result: LookupResult,
  extra: { cvError?: string | null; draftError?: string | null; note?: string | null } = {},
): Promise<void> {
  const data: FillData = result.application ?? result.base;
  const report = fillForm(collectFields(document), data);
  await fillComboboxes(report.dropdowns, report);

  let cvLine = "";
  if (report.resume) {
    const attached = data.cv
      ? attachFile(report.resume.el as HTMLInputElement, fileFrom(data.cv))
      : false;
    cvLine = attached
      ? `<div class="row ok">✓ CV attached${extra.note ? ` <span class="muted">(${esc(extra.note)})</span>` : ""}</div>`
      : data.cv
        ? `<div class="row warn">⚠ CV not attached. <a href="#" data-act="download">Download it</a> and drag it in.</div>`
        : `<div class="row warn">⚠ No CV yet${extra.cvError ? `: ${esc(extra.cvError)}` : ""}.</div>`;
  }
  highlight(report.missed);
  if (data.applicationId) sessionStorage.setItem(PENDING, data.applicationId);
  const missedCount = report.missed.length;

  render(
    `<p class="job">${esc(result.job?.title ?? pageInfo().title)}</p>
     <div class="row ok">✓ ${report.filled} field${report.filled === 1 ? "" : "s"} filled</div>
     ${cvLine}
     ${missedCount ? `<div class="row warn">⚠ ${missedCount} left for you, outlined in orange</div>` : ""}
     ${extra.draftError ? `<div class="row warn">⚠ Couldn't draft answers: ${esc(extra.draftError)}</div>` : ""}
     ${missedCount ? `<button class="main" data-act="next">Show me the next one</button>` : ""}
     <p class="muted">Check everything, then press Submit yourself. I never submit for you.
       ${result.reviewUrl ? `<br><a href="#" data-act="review">CV and answers on JobBuddy</a>` : ""}</p>`,
    {
      next: () => {
        const left = report.missed.filter((f) => {
          const el = f.el as unknown as HTMLInputElement;
          return f.options || f.choices || f.combobox ? true : !el.value?.trim();
        });
        const f = left[0];
        if (!f) return;
        const el = target(f);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (f.el as unknown as HTMLElement).focus?.();
        report.missed.push(report.missed.shift()!);
      },
      download: () => {
        if (!data.cv) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(fileFrom(data.cv));
        a.download = data.cv.fileName;
        a.click();
      },
      review: () => void send({ type: "open", url: result.reviewUrl! }),
    },
  );
}

function showError(reply: { error: string; signedOut?: boolean }): void {
  render(
    reply.signedOut
      ? `<p>Sign in to JobBuddy first: click the JobBuddy icon in Chrome's toolbar.</p>`
      : `<p class="warn">${esc(reply.error)}</p>`,
  );
}

let offered = false;

async function intro(): Promise<void> {
  offered = true;
  const result = await lookup();
  if (!result) return;
  const app = result.application;
  const status = app
    ? `<span class="pill ok">Prepared${app.cv ? " · CV ready" : ""}</span>`
    : `<span class="pill todo">${result.job ? "In JobBuddy, not prepared yet" : "New to JobBuddy"}</span>`;
  render(
    `<p class="job">${esc(result.job?.title ?? pageInfo().title)}</p>
     ${result.job ? `<p class="sub">${esc(result.job.company)}</p>` : ""}
     ${status}
     <button class="main" data-act="go">⚡ Fill this application</button>
     <p class="muted">${app ? "I'll fill your details, answers and CV." : "I'll set up the application, make your CV for this job, draft the answers and fill the form."} You press Submit.</p>`,
    { go: () => void run() },
  );
}

// ---------------------------------------------------------------- confirmation

function watchForConfirmation(): void {
  let timer: number | undefined;
  const check = () => {
    const id = sessionStorage.getItem(PENDING);
    if (!id || !isConfirmation(document, location.href)) return;
    sessionStorage.removeItem(PENDING);
    void send({ type: "applied", applicationId: id });
    render(`<div class="row ok">✓ Nice one. Marked as applied in JobBuddy.</div>`);
  };
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });
  check();
}

// ---------------------------------------------------------------- start

function hasForm(): boolean {
  return collectFields(document).filter((f) => f.kind !== "question" || f.required).length >= 3;
}

function whenFormAppears(then: () => void): void {
  if (hasForm()) return then();
  // React forms (Ashby, Workday) render late.
  let tries = 0;
  const id = window.setInterval(() => {
    if (hasForm()) {
      clearInterval(id);
      then();
    } else if (++tries > 10) clearInterval(id);
  }, 1000);
}

function boot(): void {
  if (window.__jobbuddy) return;
  window.__jobbuddy = true;
  watchForConfirmation();
  // "Fill this page" from the popup, on any site.
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === "fill-here" && hasForm()) void intro();
  });
  // The next page of a form already being filled: carry on by itself.
  if (session()) whenFormAppears(() => void run());
  // Known employer systems: offer it right away, only where the form is.
  else if (jobKeyFromUrl(location.href) || isFormHost(location.hostname)) {
    whenFormAppears(() => void intro());
  }
  // A new step on the same page (single-page forms): fill it too.
  let timer: number | undefined;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (session() && !busy && handled.size > 0 && newStepAppeared()) void run();
      // A form that opens later, e.g. in a pop-up after "Apply" (Teamtailor, Personio).
      else if (
        !offered &&
        !session() &&
        (jobKeyFromUrl(location.href) || isFormHost(location.hostname)) &&
        hasForm()
      )
        void intro();
    }, 1500);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

boot();
