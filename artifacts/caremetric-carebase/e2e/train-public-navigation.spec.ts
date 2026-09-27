import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectNoHorizontalOverflow } from "./helpers/auth";

test.describe("Train public navigation", () => {
  test.skip(process.env.PLAYWRIGHT_TRAIN_BUILD !== "true", "Requires the standalone Train frontend");
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  for (const width of [1440, 375]) {
    test(`training and trust pages share usable navigation at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Staff training for Pennsylvania care facilities", exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`train-home-${width}.png`), fullPage: true });
      for (const [label, heading] of [["Privacy", "Privacy Policy"], ["Terms", "Terms of Service"], ["Security", "Security controls you can verify"]]) {
        await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: label, exact: true }).click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
        await expect(page.getByRole("link", { name: "CareMetric Train home", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Set up a facility", exact: true })).toHaveAttribute("href", "/signup?product=train");
        await expect(page.getByRole("link", { name: "Features", exact: true })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
      await page.screenshot({ path: testInfo.outputPath(`train-security-${width}.png`), fullPage: true });
      await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Training overview", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
    });
  }
});
