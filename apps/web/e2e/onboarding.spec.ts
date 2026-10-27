import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Signs up with a fresh username, walks through every onboarding step, checks Settings,
// then deletes the account through the UI. Screenshots go to e2e-screenshots/<project>/.

const sampleCv = path.join(__dirname, "fixtures", "sample-cv.pdf");

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    },
  );
}

/** Inserts one match for the user, using any open job, like the matcher would. */
async function seedMatch(username: string) {
  const db = admin();
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const user = users.users.find((u) => u.email?.startsWith(`${username}@`));
  const { data: job } = await db.from("jobs").select("id").is("closed_at", null).limit(1).single();
  if (!user || !job) throw new Error("No user or open job to seed a match with");
  const { error } = await db.from("user_job_matches").insert({
    user_id: user.id,
    job_id: job.id,
    score: 82,
    passed_filters: true,
    breakdown: {
      technical: { points: 28, reason: "Mentions 1 must-have skills (Python)" },
      seniority: { points: 20, reason: "Senior, your level" },
      eligibility: { points: 20, reason: "Based in United Kingdom", chip: "indicated" },
      remote: { points: 10, reason: "Remote, as you want" },
      freshness: { points: 2, reason: "Posted 20 days ago" },
      compensation: { points: 2, reason: "Salary not stated" },
      top_reasons: [
        "Mentions 1 must-have skills (Python)",
        "Senior, your level",
        "Based in United Kingdom",
      ],
    },
  });
  if (error) throw error;
}

async function shot(page: Page, name: string) {
  const project = test.info().project.name;
  await page.screenshot({ path: `e2e-screenshots/${project}/${name}.png`, fullPage: true });
}

test("sign up, onboard, edit settings, delete account", async ({ page }, info) => {
  const username = `e2e-${info.project.name}-${randomUUID().slice(0, 6)}`;

  try {
    // Signed-out visitors land on the login page.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await shot(page, "01-login");

    await page.getByLabel("Username").fill(username);
    await page.getByRole("button", { name: "Continue" }).click();

    // 1. Welcome
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByText("Here's what I do")).toBeVisible();
    await shot(page, "02-welcome");
    await page.getByRole("button", { name: "Let's set you up" }).click();

    // 2. AI key: skipped here (no real keys in tests)
    await expect(page).toHaveURL(/\/onboarding\/ai$/);
    await shot(page, "03-ai-key");
    await page.getByRole("link", { name: "Skip for now" }).click();

    // 3. CV upload and confirm (no AI key, so the simple reader fills in the basics)
    await expect(page).toHaveURL(/\/onboarding\/cv$/);
    await shot(page, "04-cv-empty");
    await page.getByLabel("CV file").setInputFiles(sampleCv);
    await page.getByRole("button", { name: "Upload CV" }).click();
    await expect(page.getByLabel("Full name")).not.toHaveValue("", { timeout: 20_000 });
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("sam.tester@example.com");
    await expect(page.getByText(/couldn't reach an AI/)).toBeVisible();
    await shot(page, "05-cv-review");
    await page.getByRole("button", { name: "This is right, confirm my CV" }).click();

    // 4. Filters
    await expect(page).toHaveURL(/\/onboarding\/filters$/);
    const countries = page.getByLabel("Countries I can work in");
    await countries.fill("United Kingdom");
    await countries.press("Enter");
    await expect(page.getByRole("button", { name: "Remove United Kingdom" })).toBeVisible();
    await shot(page, "06-filters");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // 5. Fixed answers
    await expect(page).toHaveURL(/\/onboarding\/answers$/);
    await page.getByLabel("Notice period").fill("1 month");
    await page.getByLabel("Do you need visa sponsorship?").selectOption("No");
    await shot(page, "07-answers");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // 6. Tone
    await expect(page).toHaveURL(/\/onboarding\/tone$/);
    await page.getByRole("radio", { name: /^Funny/ }).check();
    await shot(page, "08-tone");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // 7. Done
    await expect(page).toHaveURL(/\/onboarding\/done$/);
    await expect(page.getByText("First results within about 2 hours")).toBeVisible();
    await shot(page, "09-done");
    await page.getByRole("button", { name: "Go to my dashboard" }).click();

    await expect(page).toHaveURL(/\/app$/);
    await shot(page, "10-dashboard-empty");

    // Dashboard with a real job: give this user one match, as the matcher would.
    await seedMatch(username);
    await page.reload();
    const card = page.locator("article").first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Eligibility indicated")).toBeVisible();
    await expect(card.getByText("Mentions 1 must-have skills (Python)")).toBeVisible();
    await shot(page, "10b-dashboard-match");

    // Explain match needs an AI key; without one it says so kindly.
    await card.getByRole("button", { name: /Explain match/ }).click();
    await expect(card.getByText(/need a working AI key/)).toBeVisible({ timeout: 30_000 });

    // Save, then find it in the Saved tab.
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.getByRole("tab", { name: "Saved" }).click();
    await expect(page.locator("article")).toHaveCount(1);

    // Not for me: hide it with a reason, then restore it from Hidden.
    await page.getByRole("button", { name: "Not for me" }).click();
    await page.getByRole("button", { name: "Wrong level" }).click();
    await expect(page.getByText(/seniority levels/)).toBeVisible();
    await shot(page, "10c-not-for-me");
    await page.getByRole("button", { name: "Hide this job" }).click();
    await expect(page.locator("article")).toHaveCount(0);
    await page.getByRole("tab", { name: "Hidden" }).click();
    await page.getByRole("button", { name: "Show again" }).click();
    await page.getByRole("tab", { name: "Matches" }).click();
    await expect(page.locator("article")).toHaveCount(1);

    // Prepare application: use the CV as it is (no AI key here), approve, get the files.
    await page.getByRole("button", { name: "Prepare application" }).click();
    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]+$/);
    await shot(page, "10d-application-start");
    await page.getByRole("button", { name: "Use my CV as it is" }).click();
    await expect(page.getByText(/Using your CV as it is/)).toBeVisible();
    await page.getByRole("button", { name: "Approve and create files" }).click();
    await expect(page.getByText(/^Approved/)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    const pdfLink = page.getByRole("link", { name: "Download PDF" });
    await expect(pdfLink).toBeVisible();
    await shot(page, "10e-application-cv");
    const pdf = await page.request.get((await pdfLink.getAttribute("href"))!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const docx = await page.request.get(
      (await page.getByRole("link", { name: "Download Word" }).getAttribute("href"))!,
    );
    expect(docx.status()).toBe(200);

    // Then move it on the board.
    await page.getByRole("link", { name: "Back to applications" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    const status = page.getByRole("combobox", { name: /^Status of / });
    await expect(status).toHaveValue("prepared");
    await status.selectOption("applied");
    // The card's date line, not the "Applied" column heading.
    await expect(page.getByText(/^Applied \d+\/\d+\/\d+/)).toBeVisible();
    await shot(page, "10f-applications");

    await page.goto("/usage");
    await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
    await shot(page, "10g-usage");

    // Settings keep what onboarding saved.
    await page.locator("header").getByRole("link", { name: "Settings" }).click();
    await expect(page.getByLabel("Notice period")).toHaveValue("1 month");
    await shot(page, "11-settings");

    // Filters live on the job board, in one place.
    await page.locator("header").getByRole("link", { name: "Jobs" }).click();
    await page.getByText("Filters", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove United Kingdom" })).toBeVisible();
    await shot(page, "11b-filters-on-job-board");

    // Signing out and back in with the same username returns to the same account.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Username").fill(username);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // Export works.
    const exportRes = await page.request.get("/api/export");
    expect(exportRes.status()).toBe(200);
    expect(exportRes.headers()["content-type"]).toBe("application/zip");

    // Delete the account through the UI.
    await page.goto("/settings#data");
    await page
      .getByLabel(`Type "${username}" to delete your account and all your data`)
      .fill(username);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    // Safety net: remove the test user even if a step failed.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const db = admin();
      const { data } = await db.auth.admin.listUsers({ perPage: 200 });
      const user = data?.users.find((u) => u.email?.startsWith(`${username}@`));
      if (user) {
        const { data: files } = await db.storage.from("cvs").list(user.id);
        if (files?.length) {
          await db.storage.from("cvs").remove(files.map((f) => `${user.id}/${f.name}`));
        }
        await db.auth.admin.deleteUser(user.id);
      }
    }
  }
});

test("rejects a bad username", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("a b");
  await page.getByRole("button", { name: "Continue" }).click();
  // getByText, not getByRole("alert"): Next.js has its own hidden route announcer alert.
  await expect(page.getByText(/letters, numbers/)).toBeVisible();
});
