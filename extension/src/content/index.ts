import { jobKeyFromUrl } from "@jobbuddy/shared";
import type { LookupResult, Message, PrepareResult, Reply } from "../types";
import {
  attachFile,
  collectFields,
  fillForm,
  formQuestions,
  isConfirmation,
  type FormField,
} from "./form";

// Runs on Greenhouse, Lever, Ashby, Workable and SmartRecruiters pages (also inside iframes
// embedded on company sites). Shows a small JobBuddy box next to the form.
// Rule: JobBuddy never clicks Submit. The user always does.

const PENDING = "jobbuddy-pending-application";

function send<T>(message: Message): Promise<Reply<T>> {
  return chrome.runtime.sendMessage(message);
}

// ---------------------------------------------------------------- the box

let shadow: ShadowRoot | null = null;

function box(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement("div");
  host.id = "jobbuddy-box";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: "closed" });
  return shadow;
}

const STYLE = `<style>
  .card{font:13px/1.4 system-ui,sans-serif;background:#fff;color:#1a1a1a;border:1px solid #d6d3d1;border-radius:12px;
    box-shadow:0 6px 24px rgba(0,0,0,.15);padding:12px 14px;width:270px}
  .title{font-weight:600;margin:0 0 6px;display:flex;justify-content:space-between;gap:8px}
  .x{background:none;border:0;cursor:pointer;font-size:16px;line-height:1;color:#78716c}
  p{margin:4px 0}
  button.main{margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer}
  button.main:disabled{opacity:.6;cursor:default}
  a{color:#4f46e5}
  .ok{color:#15803d}.warn{color:#b45309}.muted{color:#78716c;font-size:12px}
</style>`;

function render(html: string, actions: Record<string, () => void> = {}): void {
  const root = box();
  root.innerHTML = `${STYLE}<div class="card"><div class="title">JobBuddy <button class="x" data-act="close" aria-label="Close">×</button></div>${html}</div>`;
  root.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
    const act = el.dataset.act!;
    el.addEventListener("click", () => (act === "close" ? root.host.remove() : actions[act]?.()));
  });
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------------------------------------------------------------- flow

function pageInfo() {
  const og = (p: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="og:${p}"]`)?.content?.trim();
  const title =
    (document.querySelector("h1")?.textContent ?? og("title") ?? document.title)
      .trim()
      .slice(0, 300) || "Job";
  const slug = location.pathname.split("/").filter(Boolean)[0] ?? "";
  const company =
    (og("site_name") ?? slug.replace(/[-_]+/g, " ")).trim().slice(0, 200) || location.hostname;
  const description = (document.querySelector("main, #content, .content, body")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
  return { title, company, description };
}

function highlight(fields: FormField[]): void {
  for (const f of fields) {
    const el = f.options
      ? ((f.el.closest("fieldset, .application-question, .field") as HTMLElement | null) ?? f.el)
      : f.el;
    el.style.outline = "2px solid #f59e0b";
    el.style.outlineOffset = "2px";
    el.title = "JobBuddy couldn't fill this one. Please fill it yourself.";
  }
}

function fileFrom(cv: { fileName: string; base64: string }): File {
  const bytes = Uint8Array.from(atob(cv.base64), (c) => c.charCodeAt(0));
  return new File([bytes], cv.fileName, { type: "application/pdf" });
}

async function fill(result: LookupResult): Promise<void> {
  const data = result.application!;
  const fields = collectFields(document);
  const report = fillForm(fields, data);

  let cvLine = "";
  if (report.resume) {
    const attached = data.cv
      ? attachFile(report.resume.el as HTMLInputElement, fileFrom(data.cv))
      : false;
    cvLine = attached
      ? `<p class="ok">CV attached ✓</p>`
      : data.cv
        ? `<p class="warn">CV not attached. <a href="#" data-act="download">Download it</a> and drag it in.</p>`
        : `<p class="warn">No approved CV for this job yet. <a href="${esc(result.reviewUrl ?? "#")}" target="_blank">Approve it</a> first.</p>`;
  }
  highlight(report.missed);
  sessionStorage.setItem(PENDING, data.applicationId);

  render(
    `<p class="ok">Filled ${report.filled} field${report.filled === 1 ? "" : "s"}.</p>
     ${cvLine}
     ${report.missed.length ? `<p class="warn">${report.missed.length} left for you (outlined in orange).</p>` : ""}
     <p class="muted">Check everything, then press Submit yourself. I never submit for you.</p>`,
    {
      download: () => {
        if (!data.cv) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(fileFrom(data.cv));
        a.download = data.cv.fileName;
        a.click();
      },
    },
  );
}

async function prepare(): Promise<void> {
  render(`<p>Reading the questions and drafting answers...</p>`);
  const questions = formQuestions(collectFields(document));
  const reply = await send<PrepareResult>({
    type: "prepare",
    input: { url: location.href, ...pageInfo(), questions },
  });
  if (!reply.ok) return showError(reply);
  render(
    `<p class="ok">Prepared${reply.data.drafted ? `, with ${reply.data.drafted} answer${reply.data.drafted === 1 ? "" : "s"} drafted` : ""}.</p>
     <p>Check the CV and answers, approve them, then come back here and press Fill.</p>
     <button class="main" data-act="review">Review on JobBuddy</button>
     <button class="main" data-act="refill" style="background:#e7e5e4;color:#1a1a1a">Fill this application</button>`,
    {
      review: () => void send({ type: "open", url: reply.data.reviewUrl }),
      refill: () => void start(true),
    },
  );
}

function showError(reply: { error: string; signedOut?: boolean }): void {
  render(
    reply.signedOut
      ? `<p>Sign in to JobBuddy: click the JobBuddy icon in Chrome's toolbar.</p>`
      : `<p class="warn">${esc(reply.error)}</p>`,
  );
}

async function start(fillNow = false): Promise<void> {
  const reply = await send<LookupResult>({ type: "lookup", url: location.href });
  if (!reply.ok) return showError(reply);
  const result = reply.data;
  if (result.application) {
    if (fillNow) return fill(result);
    render(
      `<p><b>${esc(result.job!.title)}</b></p>
       <p class="muted">Prepared in JobBuddy${result.application.cv ? ", CV approved" : ", CV not approved yet"}.</p>
       <button class="main" data-act="fill">Fill this application</button>`,
      { fill: () => void fill(result) },
    );
    return;
  }
  render(
    `<p>${result.job ? `<b>${esc(result.job.title)}</b> isn't prepared yet.` : "This job isn't in JobBuddy yet."}</p>
     <p class="muted">I'll read the form's questions, draft answers and set up the application for you to check.</p>
     <button class="main" data-act="prepare">Prepare this one</button>`,
    { prepare: () => void prepare() },
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
    render(`<p class="ok">Nice one. Marked as applied in JobBuddy.</p>`);
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

function boot(): void {
  watchForConfirmation();
  if (!jobKeyFromUrl(location.href)) return;
  // Only where the form is (in an embedded iframe, that's the frame, not the company page).
  if (hasForm()) void start();
  else {
    // React forms (Ashby) render late.
    let tries = 0;
    const id = window.setInterval(() => {
      if (hasForm()) {
        clearInterval(id);
        void start();
      } else if (++tries > 10) clearInterval(id);
    }, 1000);
  }
}

boot();
