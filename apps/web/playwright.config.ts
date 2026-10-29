import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the built app and the real Supabase project.
// CI runs `pnpm build` first; screenshots of every screen land in e2e-screenshots/.
export default defineConfig({
  testDir: "./e2e",
  // Deletes all e2e-* test accounts after the run, even if a test timed out.
  globalTeardown: "./e2e/teardown.ts",
  timeout: 90_000,
  // The database is in Sydney and CI runs in the US, so each step can take a few seconds.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // A stuck step fails with its own name instead of hanging until the test timeout.
    actionTimeout: 20_000,
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
