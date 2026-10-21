import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Signs up with a fresh username, walks through every onboarding step, checks Settings,
// then deletes the account through the UI. Screenshots go to e2e-screenshots/<project>/.

const sampleCv = path.join(__dirname, "fixtures", "sample-cv.pdf");

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
    await page.getByLabel("Remote", { exact: true }).check();
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
    await shot(page, "10-dashboard");

    // Settings keep what onboarding saved.
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByLabel("Notice period")).toHaveValue("1 month");
    await expect(page.getByRole("button", { name: "Remove United Kingdom" })).toBeVisible();
    await shot(page, "11-settings");

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
      const admin = createClient(url, key, { auth: { persistSession: false } });
      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      const user = data?.users.find((u) => u.email?.startsWith(`${username}@`));
      if (user) {
        const { data: files } = await admin.storage.from("cvs").list(user.id);
        if (files?.length) {
          await admin.storage.from("cvs").remove(files.map((f) => `${user.id}/${f.name}`));
        }
        await admin.auth.admin.deleteUser(user.id);
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
