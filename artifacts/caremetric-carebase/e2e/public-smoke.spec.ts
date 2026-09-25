import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectNoHorizontalOverflow } from "./helpers/auth";

test.describe("public release smoke journeys", () => {
  // The marketing pages fade content in on scroll (the Reveal primitive).
  // Axe must measure settled colors, not mid-fade opacity blends, so run the
  // suite with reduced motion — Reveal renders static content in that mode.
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  const marketingPages = [
    ["/features", /Everything CareBase does/i],
    ["/security", /Security controls/i],
    ["/how-it-works", /spreadsheet chaos/i],
    ["/savings", /Where the money comes from/i],
    ["/pa-training-requirements", /Pennsylvania annual training requirements/i],
    ["/pa-dhs-citations", /most common DHS citations/i],
    ["/regulatory-updates", /Regulatory updates/i],
    ["/faq", /Frequently asked questions/i],
    ["/about", /Built in Pennsylvania/i],
    ["/privacy", /Privacy Policy/i],
    ["/terms", /Terms of Service/i],
  ] as const;

  for (const [path, heading] of marketingPages) {
    test(`${path} renders its own accessible page on direct navigation`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("keyboard users can reach and horizontally scroll public reference tables", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const tables = [
      ["/savings", ["CareBase capability comparison"]],
      ["/pa-training-requirements", ["Annual training requirements by setting", "Annual training hours by subject"]],
      ["/pa-dhs-citations", ["Personal care homes — 55 Pa. Code Ch. 2600", "Assisted living facilities — 55 Pa. Code Ch. 2800"]],
    ] as const;
    for (const [path, labels] of tables) {
      await page.goto(path);
      for (const label of labels) {
        await test.step(label, async () => {
          const region = page.getByRole("region", { name: label, exact: true });
          await region.scrollIntoViewIfNeeded();
          await expect(region).toBeVisible();
          expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
          await region.focus();
          await expect(region).toBeFocused();
          const initialLeft = await region.evaluate((element) => element.scrollLeft);
          await page.keyboard.press("ArrowRight");
          await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(initialLeft);
          await page.keyboard.press("ArrowLeft");
          await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(initialLeft);
          // Confirm the table remains in normal sequential keyboard navigation.
          // Tabbing into a wide table can scroll its links into view, so check
          // horizontal keyboard movement before changing that scroll position.
          await page.keyboard.press("Tab");
          await expect(region).not.toBeFocused();
          await page.keyboard.press("Shift+Tab");
          await expect(region).toBeFocused();
        });
      }
      await expectNoHorizontalOverflow(page);
    }
  });

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
