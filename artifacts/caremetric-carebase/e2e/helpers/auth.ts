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
 * The MFA enrollment screen's own heading. This is the *other* settled outcome of navigating to
 * a privileged route: MfaPolicyGate renders its children while the policy query is unresolved,
 * so the shell can paint and then be replaced by this a moment later (see role-journeys.spec.ts).
 *
 * Matched by role, not by tag. SessionSecurityGates renders it as a CardTitle -- a div carrying
 * role="heading" aria-level={1} -- precisely so the gate announces itself to assistive tech, so
 * an `h1` CSS selector silently matches nothing and the wait below would time out with the gate
 * plainly on screen.
 */
const MFA_GATE_HEADING = /multi-factor verification required/i;

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
 *
 * The MFA gate counts as settled too. Waiting only for the shell reintroduced the very race this
 * helper exists to close, one layer up: on a privileged route MfaPolicyGate paints the shell while
 * its policy query is in flight and swaps in the enrollment screen when the answer arrives. A
 * caller that checked for the gate before navigating (role-journeys does) has already passed that
 * check, so when the policy resolves mid-navigation the shell disappears and never returns, and
 * the helper burns its whole timeout waiting for an element the app has deliberately unmounted.
 * Which role that hits is purely down to timing, which is why it presents as a wandering flake.
 */
export async function gotoAppRoute(page: Page, path: string, timeout = 45_000): Promise<{ mfaGated: boolean }> {
  await page.goto(path);
  const shell = page.locator(APP_SHELL_READY);
  const mfaGate = page.getByRole("heading", { level: 1, name: MFA_GATE_HEADING });
  await expect(shell.or(mfaGate).first()).toBeVisible({ timeout });
  return { mfaGated: await mfaGate.isVisible().catch(() => false) };
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
