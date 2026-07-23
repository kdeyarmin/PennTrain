import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("public release smoke journeys", () => {
  // The marketing pages fade content in on scroll (framer-motion Reveal).
  // Axe must measure settled colors, not mid-fade opacity blends, so run the
  // suite with reduced motion — Reveal renders static content in that mode.
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("landing page exposes the primary conversion and sign-in paths", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", {
      level: 1,
      name: "Run the facility. See the risk. Prove the work.",
    })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start a Free Trial" }).first()).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Log In" }).first()).toHaveAttribute("href", "/login");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("demo route offers the self-serve sandbox with a trial fallback", async ({ page }) => {
    await page.goto("/demo");

    // Self-serve sandbox — no lead form. Assert on elements that don't depend on
    // VITE_DEMO_ACCOUNTS_JSON (the role picker is empty when it's unset).
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/demo/i);
    await expect(
      page.getByRole("link", { name: /free trial/i }).first(),
    ).toHaveAttribute("href", "/signup");
  });
});
