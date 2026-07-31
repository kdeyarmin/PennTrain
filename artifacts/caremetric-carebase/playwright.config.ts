import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Playwright's 30s default is the whole test, and a role journey spends it on a login plus up to
  // six authenticated routes, each of which waits for the app shell to boot against Supabase. Under
  // that default an individual wait can never reach its own timeout -- the test aborts first -- so
  // the per-step budgets in e2e/helpers/auth.ts only mean anything with room above them.
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile viewport journeys (shift, course, services, COC, public smoke).
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile-workflows|public-smoke|role-journeys/,
    },
  ],
  webServer: {
    command: "pnpm run serve",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
