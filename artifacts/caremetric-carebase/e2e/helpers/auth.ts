import { expect, type Page } from "@playwright/test";

/** Shared login helper for authenticated Playwright suites. */
export async function signInAs(
  page: Page,
  email: string,
  password: string,
  expectedPath: string | RegExp,
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
    .toMatch(typeof expectedPath === "string" ? new RegExp(`^${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) : expectedPath);
}

/**
 * Full-page boot gates: the app renders one of these instead of the route while the session, its
 * security state, and organization access resolve against Supabase. They are the only `role=status`
 * elements that take the whole viewport, which is what distinguishes them from toasts, table
 * skeletons, and per-panel loading states.
 */
const APP_BOOT_GATE = '[role="status"][class*="min-h-screen"]';

/**
 * Navigate to an authenticated route and wait for the app shell to finish booting.
 *
 * Asserting page content straight after `goto` races those boot gates, and the race is not evenly
 * matched: the gates wait on network round trips, so on a loaded CI runner they can outlast a fixed
 * per-assertion timeout. That is what made the role-journey suites flake -- on whichever role
 * happened to be slowest in that run rather than on any one broken route, which is why the failures
 * moved between roles and browser projects instead of reproducing.
 *
 * Waiting for the shell separately also makes a real failure legible: "still booting after 60s"
 * and "this route rendered no h1" stop being the same error message.
 */
export async function gotoAppRoute(page: Page, path: string, timeout = 60_000) {
  await page.goto(path);
  await expect(page.locator(APP_BOOT_GATE)).toHaveCount(0, { timeout });
}

/** Assert the live page has no horizontal overflow at the current viewport. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflowing = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  expect(overflowing, "page should not scroll horizontally on this viewport").toBe(false);
}

export function hasLiveSupabaseEnv(): boolean {
  return Boolean(
    process.env.SUPABASE_URL
    && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.VITE_SUPABASE_ANON_KEY
    && process.env.E2E_ACCOUNT_PASSWORD,
  );
}

export function requireLiveSupabaseEnv() {
  if (!hasLiveSupabaseEnv()) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY, and E2E_ACCOUNT_PASSWORD are required",
    );
  }
}
