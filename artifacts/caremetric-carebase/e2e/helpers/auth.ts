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
