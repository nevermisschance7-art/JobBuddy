// For each job board we take jobs from, opens a few stored jobs in headless Chrome, follows
// "Apply", and reports where it ends up and whether the page asks for money or an account.
// Never submits anything. Run by the "Check apply links" workflow.

import { chromium } from "@playwright/test";

const BOARDS = [
  "himalayas", "jobicy", "weworkremotely", "workingnomads", "remotive", "arbeitnow",
  "adzuna", "reed", "jooble", "hackernews",
]; // prettier-ignore
const PER = Number(process.env.PER_SOURCE ?? 3);

const PAYWALL =
  /\b(premium|upgrade|subscription|subscribe to apply|membership|members only|pricing|unlock|paid plan|per month|\/mo\b|trial)\b/i;
const ACCOUNT =
  /\b(sign up|create an account|create account|register|log in to apply|sign in to apply)\b/i;
const OPENERS =
  /^(apply|apply now|apply for this (job|position|role)|apply on company (site|website)|apply here|view job|go to job|apply externally|see job)$/i;

async function jobs(source) {
  const q = new URLSearchParams({
    select: "apply_url,title,company_name",
    source: `eq.${source}`,
    closed_at: "is.null",
    order: "posted_at.desc",
    limit: String(PER),
  });
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/jobs?${q}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  return res.ok ? res.json() : [];
}

const browser = await chromium.launch();
for (const source of BOARDS) {
  for (const job of await jobs(source)) {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    });
    const page = await context.newPage();
    const line = { source, job: `${job.title} @ ${job.company_name}`.slice(0, 60) };
    try {
      await page.goto(job.apply_url, { timeout: 30000, waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const before = await page.evaluate(() => document.body?.innerText ?? "");
      line.page = new URL(page.url()).host;
      // Follow the board's own "Apply" link once, if there is one.
      const buttons = page.locator("a, button");
      const n = Math.min(await buttons.count(), 300);
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const text = ((await b.innerText().catch(() => "")) || "").trim();
        if (!OPENERS.test(text) || !(await b.isVisible().catch(() => false))) continue;
        const popup = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
        await b.click({ timeout: 5000 }).catch(() => {});
        const opened = await popup;
        const target = opened ?? page;
        await target.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        line.after = new URL(target.url()).host;
        line.afterText = await target
          .evaluate(() => document.body?.innerText ?? "")
          .catch(() => "");
        break;
      }
      const text = `${before}\n${line.afterText ?? ""}`;
      line.paywall = PAYWALL.exec(text)?.[0] ?? null;
      line.account = ACCOUNT.exec(text)?.[0] ?? null;
      line.blocked = /just a moment|verify you are human|security verification/i.test(before);
      delete line.afterText;
    } catch (e) {
      line.error = String(e).slice(0, 120);
    }
    console.log(JSON.stringify(line));
    await context.close();
  }
}
await browser.close();
