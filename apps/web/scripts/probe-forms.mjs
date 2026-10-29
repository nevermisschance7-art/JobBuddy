// Opens real application forms in headless Chrome, runs the extension's form code on them
// with sample data, and reports what it found, filled and missed. NEVER submits: it only
// clicks links or buttons that open the form ("Apply", "I'm interested"), never anything
// that sends it.
//
// Run by the "Probe forms" workflow:
//   node scripts/probe-forms.mjs <probe.js> <out dir>
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (to pick live job links).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [probePath, outDir] = process.argv.slice(2);
const probe = readFileSync(probePath, "utf8");
mkdirSync(`${outDir}/html`, { recursive: true });
mkdirSync(`${outDir}/shots`, { recursive: true });

const PER_SOURCE = Number(process.env.PER_SOURCE ?? 3);
const SOURCES = [
  "greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor", "workday",
  "personio", "recruitee",
  // Aggregators: their links lead to all kinds of employer sites.
  "himalayas", "remoteok", "weworkremotely", "jobicy", "arbeitnow",
]; // prettier-ignore

const SAMPLE = {
  applicationId: "probe",
  status: "prepared",
  profile: {
    fullName: "Sam Tester",
    firstName: "Sam",
    lastName: "Tester",
    email: "sam.tester@example.com",
    phone: "+44 7700 900123",
    city: "Manchester",
    countryCode: "GB",
    linkedin: "https://www.linkedin.com/in/sam-tester",
    github: "https://github.com/samtester",
    website: "https://samtester.dev",
  },
  fixedAnswers: {
    work_authorized: "Yes",
    right_to_work: "UK",
    needs_sponsorship: "No",
    notice_period: "1 month",
    salary_expectation: "70,000 GBP",
    willing_to_relocate: "No",
    location: "Manchester, United Kingdom",
    pronouns: "they/them",
    demographics: "I prefer not to say",
    linkedin_url: "https://www.linkedin.com/in/sam-tester",
  },
  answers: [
    {
      question: "Why do you want to work here?",
      answer: "I like the product.",
      isCoverLetter: false,
    },
    { question: "Cover letter", answer: "Hi team, I would like to apply.", isCoverLetter: true },
  ],
  cv: null,
};

async function jobLinks() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = [];
  for (const source of SOURCES) {
    const q = new URLSearchParams({
      select: "source,apply_url,canonical_url,title,company_name",
      source: `eq.${source}`,
      closed_at: "is.null",
      order: "posted_at.desc",
      limit: String(PER_SOURCE),
    });
    const res = await fetch(`${url}/rest/v1/jobs?${q}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (res.ok) out.push(...(await res.json()));
  }
  return out;
}

/** The address of the form itself, where a system has a known one. */
function formUrl(job) {
  const u = job.canonical_url || job.apply_url;
  if (job.source === "lever") return u.replace(/\/?$/, "/apply");
  if (job.source === "ashby")
    return u.replace(/\/application\/?$/, "").replace(/\/?$/, "/application");
  if (job.source === "workable") return u.replace(/\/apply\/?$/, "").replace(/\/?$/, "/apply/");
  return job.apply_url || u;
}

// Only buttons/links that OPEN a form. Anything that could send one is never clicked.
const OPENERS =
  /^(apply|apply now|apply for this (job|position|role)|apply to this job|apply here|i'?m interested|start application|start your application|apply manually|easy apply)$/i;
const NEVER = /submit|send|finish|complete|confirm/i;

async function openForm(page) {
  for (let i = 0; i < 2; i++) {
    const candidates = page.locator("a, button, [role='button']");
    const count = Math.min(await candidates.count(), 400);
    let clicked = false;
    for (let j = 0; j < count; j++) {
      const el = candidates.nth(j);
      const text = ((await el.innerText().catch(() => "")) || "").trim();
      if (!OPENERS.test(text) || NEVER.test(text) || !(await el.isVisible().catch(() => false)))
        continue;
      const popup = page
        .context()
        .waitForEvent("page", { timeout: 3000 })
        .catch(() => null);
      await el.click({ timeout: 5000 }).catch(() => {});
      const opened = await popup;
      if (opened) {
        await page.goto(opened.url(), { timeout: 30000 }).catch(() => {});
        await opened.close().catch(() => {});
      }
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      clicked = true;
      break;
    }
    if (!clicked) return;
    const inputs = await page.locator("input:not([type=hidden]), textarea").count();
    if (inputs >= 3) return;
  }
}

/** The page's HTML without scripts and styles: a small, safe test fixture. */
const CLEAN_HTML = `(() => {
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll("script, style, link, noscript, svg, img, iframe, video").forEach((n) => n.remove());
  return "<!doctype html>" + doc.outerHTML;
})()`;

async function probeJob(browser, job, n) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  // Belt and braces: block any form submission the page might attempt.
  await page.route("**/*", (route) => {
    const r = route.request();
    if (r.method() === "POST" && r.resourceType() === "document") return route.abort();
    return route.continue();
  });
  const start = formUrl(job);
  const result = { source: job.source, company: job.company_name, start, frames: [] };
  try {
    await page.goto(start, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await openForm(page);
    await page.waitForTimeout(2500);
    result.final = page.url();

    let best = null;
    for (const frame of page.frames()) {
      const inputs = await frame
        .locator("input:not([type=hidden]), textarea, select")
        .count()
        .catch(() => 0);
      if (inputs < 2) continue;
      const html = await frame.evaluate(CLEAN_HTML).catch(() => null);
      await frame.addScriptTag({ content: probe }).catch(() => {});
      const r = await frame
        .evaluate((data) => window.JobBuddyProbe?.run(data), SAMPLE)
        .catch((e) => ({ error: String(e) }));
      if (!r) continue;
      result.frames.push(r);
      if (!r.error && (!best || r.fields.length > best.r.fields.length)) best = { r, html };
    }
    if (best?.html) {
      writeFileSync(`${outDir}/html/${job.source}-${n}.html`, best.html);
      result.fixture = `${job.source}-${n}.html`;
    }
    await page
      .screenshot({ path: `${outDir}/shots/${job.source}-${n}.png`, fullPage: true })
      .catch(() => {});
  } catch (e) {
    result.error = String(e).slice(0, 300);
  }
  await context.close();
  return result;
}

const browser = await chromium.launch();
const jobs = await jobLinks();
const results = [];
const seen = {};
for (const job of jobs) {
  seen[job.source] = (seen[job.source] ?? 0) + 1;
  const r = await probeJob(browser, job, seen[job.source]);
  results.push(r);
  const f = r.frames.find((x) => !x.error) ?? {};
  console.log(
    `\n### ${r.source} · ${r.company} · ${r.final ?? r.start}` +
      (r.error ? `\n  ERROR ${r.error}` : "") +
      `\n  fields ${f.fields?.length ?? 0}, filled ${f.filled ?? 0}, resume ${f.resume ?? false}` +
      `\n  missed: ${(f.missed ?? []).slice(0, 15).join(" | ")}` +
      `\n  kinds: ${(f.fields ?? []).map((x) => `${x.kind}[${x.control}]`).join(", ")}`,
  );
}
await browser.close();
writeFileSync(`${outDir}/report.json`, JSON.stringify(results, null, 2));

const withForm = results.filter((r) => r.frames.some((f) => !f.error && f.fields.length >= 3));
console.log(`\n${withForm.length} of ${results.length} pages had a form.`);
