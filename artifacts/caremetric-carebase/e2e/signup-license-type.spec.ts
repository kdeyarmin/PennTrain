import { expect, test } from "@playwright/test";

// No real organization or invitation is created. The handler/database tests cover persistence;
// this browser journey proves that choosing a chapter is required and reaches the request.
for (const product of ["carebase", "train"]) {
  for (const license of [
    { code: "PCH", label: "Personal Care Home (PCH)" },
    { code: "ALR", label: "Assisted Living Facility (ALF)" },
  ]) {
    test(`${product} signup requires an explicit ${license.label} selection`, async ({ page }, testInfo) => {
      const requests: Record<string, unknown>[] = [];
      await page.addInitScript(() => {
        Object.assign(window, { turnstile: {
          render: (_container: HTMLElement, options: { callback: (token: string) => void }) => {
            queueMicrotask(() => options.callback("browser-test-proof"));
            return "test-widget";
          },
          reset: () => {}, remove: () => {},
        } });
      });
      await page.route("**/functions/v1/get-platform-status", route => route.fulfill({ json: { maintenanceMode: false, signupEnabled: true } }));
      await page.route("**/functions/v1/signup-organization", route => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ json: { success: true, requiresEmailVerification: true } });
      });
      await page.goto(`/signup?product=${product}`);
      const licenseType = page.getByRole("combobox", { name: "Facility license type", exact: true });
      await expect(licenseType).toHaveValue("");
      await expect(licenseType).toHaveAttribute("required", "");
      await expect(licenseType.locator("option")).toHaveText(["Select PCH or ALF", "Personal Care Home (PCH)", "Assisted Living Facility (ALF)"]);
      await page.getByLabel("Organization / Facility Name", { exact: true }).fill("New licensed facility");
      await page.getByLabel("First Name", { exact: true }).fill("Facility");
      await page.getByLabel("Last Name", { exact: true }).fill("Administrator");
      await page.getByLabel("Work Email", { exact: true }).fill("admin@example.test");
      await expect(page.getByRole("link", { name: "Facility Administrator Agreement", exact: true })).toHaveAttribute("href", "/legal/facility-signup#facility-administrator-agreement");
      await expect(page.getByRole("link", { name: "HIPAA Business Associate Agreement", exact: true })).toHaveAttribute("href", "/legal/facility-signup#business-associate-agreement");
      await expect(page.locator('label[for="legalAccepted"]')).not.toContainText(/\bbind\b|CareMetric-.*-v\d/);
      await page.getByRole("checkbox").check();
      const submit = page.getByRole("button", { name: "Send verification email", exact: true });
      await expect(submit).toBeDisabled();
      expect(requests).toEqual([]);
      await licenseType.selectOption({ label: license.label });
      await expect(submit).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath("signup-license-type.png"), fullPage: true });
      await submit.click();
      await expect(page.getByText("We sent an invite link to admin@example.test.", { exact: true })).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        facility_type: license.code,
        organization_name: "New licensed facility",
        service_agreement_version: "CareMetric-Facility-Admin-Service-Agreement-v2026-07-14",
        baa_version: "CareMetric-HIPAA-BAA-v2026-07-14",
      });
    });
  }
}
