import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { hasLiveSupabaseEnv, signInAs, expectNoHorizontalOverflow } from "./helpers/auth";
import { facilityToday } from "./helpers/facilityDay";
import { totpCode } from "./helpers/totp";

async function verifyNewAdministrator(page: Page) {
  await expect(page.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
  await page.getByRole("link", { name: "Open account security" }).click();
  await page.getByRole("button", { name: "Add authenticator app", exact: true }).click();
  const key = page.getByText("Manual setup key", { exact: true }).locator("..").locator("code");
  await expect(key).toBeVisible();
  const secret = (await key.innerText()).trim();
  await page.getByLabel("Authenticator code", { exact: true }).fill(totpCode(secret));
  const verifiedSession = page.waitForResponse(response => response.url().includes("/auth/v1/factors/") && response.url().endsWith("/verify") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Verify authenticator", exact: true }).click();
  const session = await (await verifiedSession).json() as { access_token: string; refresh_token: string };
  await expect(page.getByText(/This session is already verified/)).toBeVisible();
  await page.getByRole("button", { name: "Continue to the page you were opening" }).click();
  return session;
}

test.describe("reviewed facility starter kits and assignment rules", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase test credentials required");
  test("owner kit, explicit facility deadline, matching preview and approved new-staff automation", async ({ page, browser }, testInfo) => {
    test.setTimeout(300_000);
    test.skip(process.env.PLAYWRIGHT_TRAIN_BUILD === "true", "global kit authoring uses the universal owner console");
    const url = process.env.SUPABASE_URL!, password = process.env.E2E_ACCOUNT_PASSWORD!;
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(new URL(String(testInfo.project.use.baseURL)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const suffix = crypto.randomUUID(), title = `Kit orientation ${suffix}`, kitName = `Orientation kit ${suffix}`;
    const { data: org, error: orgError } = await service.from("organizations").insert({ name: `Kit partner ${suffix}`, slug: `kit-partner-${suffix}`, is_demo: false }).select("id").single();
    if (orgError) throw orgError;
    const { error: entitlementError } = await service.rpc("configure_train_signup", { p_organization_id: org.id, p_complimentary: true });
    if (entitlementError) throw entitlementError;
    const { data: facility, error: facilityError } = await service.from("facilities").insert({ organization_id: org.id, name: `Kit facility ${suffix}`, facility_type: "PCH" }).select("id,name").single();
    if (facilityError) throw facilityError;
    async function account(role: "org_admin" | "platform_admin") {
      const email = `kit-${role}-${suffix}@test.local`;
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true,
        app_metadata: { role, ...(role === "org_admin" ? { organization_id: org.id } : {}) } });
      if (error || !data.user) throw error || new Error("No test identity returned");
      const { error: profileError } = await service.rpc("admin_update_profile", { p_user_id: data.user.id, p_role: role, p_is_active: true,
        ...(role === "org_admin" ? { p_organization_id: org.id } : {}) });
      if (profileError) throw profileError;
      return { email, id: data.user.id };
    }
    const owner = await account("platform_admin"), manager = await account("org_admin");
    const { data: staff, error: staffError } = await service.from("employees").insert([
      { organization_id: org.id, facility_id: facility.id, first_name: "Matching", last_name: "Caregiver", job_title: "Caregiver", department: "Care", status: "active" },
      { organization_id: org.id, facility_id: facility.id, first_name: "Other", last_name: "Department", job_title: "Caregiver", department: "Dietary", status: "active" },
    ]).select("id,first_name");
    if (staffError) throw staffError;
    const { data: course, error: courseError } = await service.from("courses").insert({ organization_id: null, title, status: "draft" }).select("id").single();
    if (courseError) throw courseError;
    const { data: version, error: versionError } = await service.from("course_versions").insert({ course_id: course.id, organization_id: null,
      title, version_number: 1, status: "draft", content_standard: "legacy" }).select("id").single();
    if (versionError) throw versionError;
    const { error: blockError } = await service.from("course_blocks").insert({ course_version_id: version.id, organization_id: null, block_type: "text", sort_order: 0,
      title: "Classroom orientation", body: { content: "Disposable global classroom course for starter-kit workflow tests." } });
    if (blockError) throw blockError;
    await signInAs(page, owner.email, password, "/admin");
    const ownerSession = await verifyNewAdministrator(page);
    const publisher = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    // Reuse the real owner session verified through the UI, including its AAL2
    // proof, rather than publishing with a new unverified fixture login.
    const { error: loginError } = await publisher.auth.setSession(ownerSession);
    if (loginError) throw loginError;
    const { error: publicationError } = await publisher.rpc("publish_course_version", { p_course_version_id: version.id });
    if (publicationError) throw publicationError;
    const { error: activationError } = await publisher.from("courses").update({ status: "published" }).eq("id", course.id);
    if (activationError) throw activationError;

    await page.goto("/admin/organizations");
    await page.getByText("Manage Training starter kits", { exact: true }).click();
    await page.getByRole("button", { name: "New starter kit", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Create starter kit", exact: true });
    await editor.getByLabel("Kit name", { exact: true }).fill(kitName);
    await editor.getByLabel("Description and suggested audience", { exact: true }).fill("Reviewed starting point for caregiver orientation.");
    await editor.getByLabel("Find published global courses", { exact: true }).fill(title);
    await editor.getByRole("checkbox", { name: title, exact: true }).check();
    await editor.getByRole("checkbox", { name: "Publish for facility administrators", exact: true }).check();
    await editor.getByRole("button", { name: "Save starter kit", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.getByLabel("Find partner facility", { exact: true }).fill(suffix);
    const partner = page.getByRole("row").filter({ hasText: facility.name });
    await expect(partner).toBeVisible();
    await partner.getByLabel("Starter kit for administrator").selectOption({ label: kitName });
    await partner.getByRole("button", { name: "Offer starter kit", exact: true }).click();
    await expect(partner).toContainText("Ready in the administrator’s Learning Plans");

    const managerContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
    const admin = await managerContext.newPage();
    try {
      await signInAs(admin, manager.email, password, "/app/train");
      await verifyNewAdministrator(admin);
      await admin.getByRole("tab", { name: "Learning Plans", exact: true }).click();
      await admin.getByRole("button", { name: `Review ${kitName}`, exact: true }).click();
      const review = admin.getByRole("dialog", { name: "Review starter kit", exact: true });
      await expect(review).toContainText(title);
      await expect(review.getByLabel("Completion deadline", { exact: true })).toHaveValue("");
      await expect(review.getByRole("button", { name: "Create editable facility plan", exact: true })).toBeDisabled();
      const year = Number(facilityToday().slice(0, 4)) + 1, deadline = `${year + 1}-01-15`, planName = `Facility orientation ${suffix}`;
      await review.getByLabel("Facility plan name", { exact: true }).fill(planName);
      await review.getByLabel("Training year", { exact: true }).fill(String(year));
      await review.getByLabel("Completion deadline", { exact: true }).fill(deadline);
      await review.getByRole("button", { name: "Create editable facility plan", exact: true }).click();
      await expect(review).not.toBeVisible();
      await admin.getByText("Role and department assignment rules", { exact: true }).click();
      await admin.getByLabel("Job title / staff role", { exact: true }).fill("Caregiver");
      await admin.getByLabel("Department", { exact: true }).fill("Care");
      await admin.getByRole("button", { name: "Save matching rule", exact: true }).click();
      await admin.getByRole("button", { name: "Preview matching staff", exact: true }).click();
      const preview = admin.getByRole("region", { name: "Role rule assignment preview", exact: true });
      await expect(preview).toContainText("1 pending matches");
      await expect(preview).toContainText("Matching Caregiver");
      await expect(preview).not.toContainText("Other Department");
      await preview.getByRole("checkbox", { name: "Select up to 100 pending matches", exact: true }).check();
      await preview.getByRole("button", { name: "Confirm plan for 1 employees", exact: true }).click();
      await expect(preview).toContainText("0 pending matches");
      const { data: assigned, error: assignedError } = await service.from("course_assignments").select("employee_id,due_date").eq("organization_id", org.id);
      if (assignedError) throw assignedError;
      expect(assigned).toEqual([{ employee_id: staff.find(e => e.first_name === "Matching")!.id, due_date: deadline }]);
      await preview.getByRole("checkbox", { name: /I approve these courses/ }).check();
      await preview.getByRole("button", { name: "Enable approved automatic assignments", exact: true }).click();
      await expect(admin.getByText("Automatic mode was approved. Preview to check whether the saved courses and deadline are still current.")).toBeVisible();
      await admin.getByRole("tab", { name: "Staff", exact: true }).click();
      await admin.getByRole("link", { name: "Add student", exact: true }).click();
      const employee = admin.getByRole("dialog", { name: "Add Employee", exact: true });
      await employee.getByLabel("First Name *", { exact: true }).fill("Automatic");
      await employee.getByLabel("Last Name *", { exact: true }).fill("Caregiver");
      await employee.getByLabel("Job Title", { exact: true }).fill("Caregiver");
      await employee.getByLabel("Department", { exact: true }).fill("Care");
      await employee.getByRole("checkbox", { name: /Send portal invite/ }).uncheck();
      await employee.getByRole("button", { name: "Create Employee", exact: true }).click();
      await expect(employee).not.toBeVisible();
      const { data: created, error: createdError } = await service.from("employees").select("id").eq("organization_id", org.id).eq("first_name", "Automatic").single();
      if (createdError) throw createdError;
      const { data: automatic, error: automaticError } = await service.from("course_assignments").select("course_id,due_date").eq("employee_id", created.id);
      if (automaticError) throw automaticError;
      expect(automatic).toEqual([{ course_id: course.id, due_date: deadline }]);
      await admin.getByRole("link", { name: "Back to training", exact: true }).click();
      await admin.getByRole("tab", { name: "Learning Plans", exact: true }).click();
      await admin.getByRole("button", { name: planName, exact: true }).click();
      await admin.getByText("Role and department assignment rules", { exact: true }).click();
      await admin.getByRole("button", { name: "Preview matching staff", exact: true }).click();
      await expect(preview).toContainText("0 pending matches · 2 already enrolled");
      await expect(preview).toContainText("Automatic mode is approved for these courses and this exact deadline.");
      await expectNoHorizontalOverflow(admin);
      await admin.screenshot({ path: "test-results/training-starter-rules.png", fullPage: true });
    } finally { await managerContext.close(); }
  });
});
