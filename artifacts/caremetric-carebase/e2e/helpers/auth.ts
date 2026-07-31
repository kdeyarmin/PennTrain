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
 * The authenticated shell's main landmark. MainLayout renders it only after the session, its
 * security state, and organization access have all resolved -- so its presence is a positive
 * "boot finished" signal.
 */
const APP_SHELL_READY = "main#main-content";

/**
 * Navigate to an authenticated route and wait for the app shell to finish booting.
 *
 * Asserting page content straight after `goto` races the app's full-page boot gates, and the race
 * is not evenly matched: those gates wait on Supabase round trips, so on a loaded CI runner they
 * can outlast a fixed per-assertion timeout. That is what made the role-journey suites flake -- on
 * whichever role happened to be slowest in a given run rather than on any one broken route, which
 * is why the failures moved between roles and browser projects instead of reproducing.
 *
 * This waits for the shell to be *present*, not for a loader to be *absent*. Absence is not a
 * usable signal here: `page.goto` resolves on `load`, before React has necessarily committed its
 * first render, so "no boot gate on the page" is equally true before booting starts and after it
 * finishes. Waiting for that would pass instantly and leave the original race untouched.
 *
 * Splitting the wait also makes a real failure legible: "the shell never came up" and "this route
 * rendered no h1" stop being the same error message.
 */
export async function gotoAppRoute(page: Page, path: string, timeout = 45_000) {
  await page.goto(path);
  await expect(page.locator(APP_SHELL_READY)).toBeVisible({ timeout });
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
