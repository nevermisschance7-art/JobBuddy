import { fixedKeyFor, isFormHost, jobKeyFromUrl, questionSimilarity } from "@jobbuddy/shared";
import type { FillData, LookupResult, Message, PrepareResult, Reply } from "../types";
import {
  attachFile,
  choiceLabels,
  collectFields,
  currentAnswer,
  PLACEHOLDER,
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

type AiWork = { questions: string[]; choices: { question: string; options: string[] }[] };

/**
 * Unanswered questions the AI may help with, never sensitive ones: free text to draft, and
 * choice questions (radios, Yes/No buttons, selects) to pick from the CV. Required ones first,
 * then optional ones, all in the same request.
 */
function aiWork(missed: FormField[]): AiWork {
  // Required questions first, so they always fit within the per-request limits.
  const ordered = [...missed.filter((f) => f.required), ...missed.filter((f) => !f.required)];
  const open = ordered.filter(
    (f) =>
      (f.kind === "question" || f.kind === "cover_letter") &&
      !fixedKeyFor(f.label) &&
      f.label.length > 2,
  );
  const isChoice = (f: FormField) => Boolean(f.options || f.choices || f.el.tagName === "SELECT");
  const questions = [
    ...new Set(open.filter((f) => !isChoice(f) && !f.combobox).map((f) => f.label)),
  ].slice(0, 12);
  const choices = open
    .filter((f) => isChoice(f) && f.kind === "question")
    .map((f) => ({
      question: f.label,
      options: choiceLabels(f)
        .map((o) => o.trim())
        .filter((o) => o && !/^(select|choose|please select|--)/i.test(o)),
    }))
    .filter((c) => c.options.length >= 2)
    .slice(0, 15);
  return { questions, choices };
}

const workSize = (w: AiWork) => w.questions.length + w.choices.length;

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

/** Fields already handled on this page, to notice when a new step appears. By element and by
 * label: clicking a field often re-renders it or adds "This field is required" to its label. */
const handled = new Set<string>();
const handledEls = new WeakSet<object>();
let busy = false;

/** When the user last typed, clicked or moved into a field: no automatic fill around then. */
let lastUserAction = 0;
for (const type of ["keydown", "mousedown", "focusin", "input", "change"]) {
  document.addEventListener(
    type,
    (e) => {
      if (e.isTrusted && !(e.target as Element | null)?.closest?.("#jobbuddy-box")) {
        lastUserAction = Date.now();
      }
    },
    true,
  );
}

function userIsWorking(): boolean {
  const active = document.activeElement as HTMLElement | null;
  const inField =
    !!active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
  return inField || Date.now() - lastUserAction < 4000;
}

function newStepAppeared(): boolean {
  const fresh = collectFields(document).filter((f) => {
    if (handledEls.has(f.el) || handled.has(f.label)) return false;
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
    for (const f of collectFields(document)) {
      handled.add(f.label);
      handledEls.add(f.el);
    }
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
  const firstFill = fillForm(collectFields(document), {
    ...(result.application ?? result.base),
    jobCompany: result.job?.company ?? pageInfo().company,
  });
  const work = aiWork(firstFill.missed);

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
    workSize(work) > 0
      ? send<PrepareResult>({
          type: "prepare",
          input: { url: location.href, ...info, ...work, applicationId },
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
  const data: FillData = {
    ...(result.application ?? result.base),
    jobCompany: result.job?.company ?? pageInfo().company,
  };
  const fields = collectFields(document);
  const report = fillForm(fields, data);
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

  // Required fields left: orange. Optional ones left: no outline (the form accepts them empty).
  // Answers written or picked by the AI: blue, to check.
  lastMissed = report.missed;
  const required = report.missed.filter((f) => f.required);
  const optional = report.missed.filter((f) => !f.required);
  const byAi = fields.filter(
    (f) =>
      !report.missed.includes(f) &&
      (f.kind === "question" || f.kind === "cover_letter") &&
      !fixedKeyFor(f.label) &&
      data.answers.some(
        (a) =>
          a.ai &&
          (a.isCoverLetter
            ? f.kind === "cover_letter"
            : questionSimilarity(f.label, a.question) >= 0.6),
      ),
  );
  clearOutlines();
  outline(
    required,
    "#f59e0b",
    "JobBuddy couldn't fill this required field. Please fill it yourself.",
  );
  outline(byAi, "#4f46e5", "Written or picked by AI from your CV. Please check it.");
  if (data.applicationId) sessionStorage.setItem(PENDING, data.applicationId);
  let next = 0;

  // A form asking which US state you live in, or for US work authorisation, while the user
  // lives elsewhere: probably a US-residents-only job. Say so before they spend time on it.
  const usOnly =
    data.profile.countryCode !== "US" &&
    fields.some(
      (f) =>
        /which (u\.?s\.? )?state|state (do|did) you (legally )?(reside|live)|u\.?s\.? state|authori[sz]ed to work (for any employer )?in the (united states|u\.?s)/i.test(
          f.label,
        ) ||
        (choiceLabels(f).includes("Alabama") && choiceLabels(f).includes("Wyoming")),
    );
  render(
    `<p class="job">${esc(result.job?.title ?? pageInfo().title)}</p>
     ${usOnly ? `<div class="row warn">⚠ This form asks about US states or US work authorisation. The job may be for US residents only.</div>` : ""}
     <div class="row ok">✓ ${report.filled} field${report.filled === 1 ? "" : "s"} filled</div>
     ${cvLine}
     ${byAi.length ? `<div class="row" style="color:#4f46e5">✎ ${byAi.length} answer${byAi.length === 1 ? "" : "s"} by AI, outlined in blue: please check</div>` : ""}
     ${required.length ? `<div class="row warn">⚠ ${required.length} required left for you, outlined in orange</div>` : `<div class="row ok">✓ Every required field is filled</div>`}
     ${optional.length ? `<div class="row muted">○ ${optional.length} optional left empty (fine to skip)</div>` : ""}
     ${extra.draftError ? `<div class="row warn">⚠ Couldn't draft answers: ${esc(extra.draftError)}</div>` : ""}
     ${required.length ? `<button class="main" data-act="next">Show me the next required one</button>` : ""}
     <p class="muted">Check everything, then press Submit yourself. I never submit for you.
       ${result.reviewUrl ? `<br><a href="#" data-act="review">CV and answers on JobBuddy</a>` : ""}</p>`,
    {
      next: () => {
        const f = required[next++ % required.length];
        if (!f) return;
        target(f).scrollIntoView({ behavior: "smooth", block: "center" });
        (f.el as unknown as HTMLElement).focus?.();
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

// ---------------------------------------------------------------- learning from the user

/** Fields JobBuddy couldn't fill on this page; what the user types there is learned. */
let lastMissed: FormField[] = [];

/**
 * Saves what the user typed or picked in fields JobBuddy left empty (address line, post
 * code, "which status allows you to work"...), so next time they are filled by themselves.
 * Kept per user, never sent to any AI.
 */
/** Not learned: tick boxes (consent and terms are the user's to give each time), and
 * "questions" that are only a dropdown's placeholder ("Select One"). */
function worthLearning(f: FormField): boolean {
  if ((f.el as unknown as HTMLInputElement).type === "checkbox") return false;
  if (f.options?.every((o) => o.el.type === "checkbox")) return false;
  return !PLACEHOLDER.test(f.label);
}

/** An internal option id ("db69d266446c11de98360015c5e6daf6"), not words the user picked. */
function looksLikeCode(answer: string): boolean {
  return (
    !/\s/.test(answer) &&
    answer.length >= 12 &&
    /\d/.test(answer) &&
    /[a-z]/i.test(answer) &&
    /^[\w-]+$/.test(answer)
  );
}

function learnFromUser(): void {
  const items = lastMissed
    .filter((f) => worthLearning(f))
    .map((f) => ({ question: f.label, answer: currentAnswer(f) ?? "" }))
    .filter((i) => i.question.length > 2 && i.answer && i.answer.length <= 300)
    .filter((i) => !looksLikeCode(i.answer) && !PLACEHOLDER.test(i.answer))
    .filter((i) => i.answer.toLowerCase() !== i.question.toLowerCase());
  if (items.length === 0) return;
  const done = new Set(items.map((i) => i.question));
  lastMissed = lastMissed.filter((f) => !done.has(f.label));
  void send({ type: "learn", items });
}

const outlined = new Set<HTMLElement>();

function clearOutlines(): void {
  for (const el of outlined) {
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.removeAttribute("title");
  }
  outlined.clear();
}

function outline(fields: FormField[], color: string, title: string): void {
  for (const f of fields) {
    const el = target(f);
    el.style.outline = `2px solid ${color}`;
    el.style.outlineOffset = "3px";
    el.title = title;
    outlined.add(el);
  }
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

function markApplied(): void {
  const id = sessionStorage.getItem(PENDING);
  if (!id) return;
  sessionStorage.removeItem(PENDING);
  void send({ type: "applied", applicationId: id });
  render(`<div class="row ok">✓ Nice one. Marked as applied in JobBuddy.</div>`);
}

/** Error messages a form shows when Submit didn't go through (visible ones only). */
function formErrorsShown(): boolean {
  const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
  const invalid = [...document.querySelectorAll("[aria-invalid='true']")].some(visible);
  const alerts = [...document.querySelectorAll("[role='alert']")].some(
    (el) => visible(el) && (el.textContent ?? "").trim().length > 0,
  );
  return invalid || alerts;
}

function watchForConfirmation(): void {
  let timer: number | undefined;
  const check = () => {
    if (sessionStorage.getItem(PENDING) && isConfirmation(document, location.href)) markApplied();
  };
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });
  check();

  // The user pressed Submit on a form JobBuddy filled. JobBuddy never presses it itself.
  // If the form goes away (or a thank-you page shows) with no error messages, it went through.
  const submitted = () => {
    if (!sessionStorage.getItem(PENDING)) return;
    let tries = 0;
    const wait = window.setInterval(() => {
      tries++;
      if (isConfirmation(document, location.href) || (!hasForm() && !formErrorsShown())) {
        clearInterval(wait);
        markApplied();
      } else if (formErrorsShown() || tries > 8) {
        clearInterval(wait); // errors to fix, or still on the form: not applied yet
      }
    }, 1000);
  };
  document.addEventListener("submit", submitted, true);
  document.addEventListener("submit", learnFromUser, true);
  // Moving to the next page of a form (or submitting) is when the user's own answers count.
  document.addEventListener(
    "click",
    (e) => {
      const button = (e.target as Element | null)?.closest?.(
        "button, input[type='submit'], [role='button'], a",
      );
      if (!button || !e.isTrusted) return;
      const text = `${button.textContent ?? ""} ${(button as HTMLInputElement).value ?? ""}`;
      if (/next|continue|submit|send|apply|save|review/i.test(text)) learnFromUser();
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      const button = (e.target as Element | null)?.closest?.(
        "button, input[type='submit'], [role='button']",
      );
      if (!button || !e.isTrusted) return; // only the user's own clicks
      const text = `${button.textContent ?? ""} ${(button as HTMLInputElement).value ?? ""}`;
      if (/submit|send application|apply now|complete application|finish/i.test(text)) submitted();
    },
    true,
  );
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
  const onChange = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Never while the user is typing or picking: wait until they pause.
      if (session() && !busy && handled.size > 0 && userIsWorking()) return onChange();
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
  };
  new MutationObserver(onChange).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

boot();
