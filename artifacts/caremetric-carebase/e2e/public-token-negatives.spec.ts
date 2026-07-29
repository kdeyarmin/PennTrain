import { expect, test } from "@playwright/test";

/**
 * Public-token negative paths: garbage / missing credentials must deny access
 * without flashing terms or resident data. Complements the happy-path coverage
 * in role-routing.spec.ts.
 */
test.describe("public access token negatives", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("evidence room rejects a garbage token without showing the terms step", async ({ page }) => {
    await page.goto("/evidence-access/not-a-real-evidence-token");
    await expect(page.getByRole("heading", { name: /no longer available/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept terms/i })).toHaveCount(0);
  });

  test("evidence room rejects a missing token path", async ({ page }) => {
    await page.goto("/evidence-access/");
    await expect(page.getByRole("heading", { name: /no longer available/i })).toBeVisible();
  });

  test("designated-person portal rejects a garbage access token", async ({ page }) => {
    // Long enough to clear the client length gate and hit get_resident_portal_experience.
    await page.goto("/resident-portal?access=not-a-real-portal-token-xxxxxxxxxxxxxxxx");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/resident-portal");
    // Credential must be stripped from the URL even when invalid.
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByRole("heading", { name: /Access link unavailable/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Review portal terms/i })).toHaveCount(0);
  });

  test("designated-person portal rejects an undersized access token without a blank page", async ({ page }) => {
    await page.goto("/resident-portal?access=short-token");
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByRole("heading", { name: /Access link unavailable/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Review portal terms/i })).toHaveCount(0);
  });

  test("designated-person portal without a token stays unavailable", async ({ page }) => {
    await page.goto("/resident-portal");
    await expect(page.getByRole("heading", { name: /Access link unavailable/i })).toBeVisible();
    await expect(page.getByText(/For emergencies, call 911/)).toHaveCount(0);
  });

  test("agreement guest portal rejects a garbage token without terms", async ({ page }) => {
    await page.goto("/resident-agreement-access/not-a-real-agreement-token");
    await expect(page.getByText(/Agreement link unavailable/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept/i })).toHaveCount(0);
  });

  test("move-in guest portal rejects a garbage token without terms", async ({ page }) => {
    await page.goto("/move-in-access/not-a-real-move-in-token");
    await expect(page.getByText(/Guest link unavailable/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept/i })).toHaveCount(0);
  });
});
