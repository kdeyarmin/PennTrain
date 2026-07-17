import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("public release smoke journeys", () => {
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

  test("request-demo route renders a usable lead form", async ({ page }) => {
    await page.goto("/request-demo");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/demo/i);
    await expect(page.getByRole("button", { name: /request|submit|send/i })).toBeVisible();
  });
});
