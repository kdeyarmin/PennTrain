import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { hasLiveSupabaseEnv, signInAs } from "./helpers/auth";

test.describe("standalone Train", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase test credentials required");
  test("a Train-only administrator can set up students, review evidence and export without operational modules", async ({ page }) => {
    const url = process.env.SUPABASE_URL!;
    // Refuse accidental execution against a customer environment.
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const suffix = crypto.randomUUID();
    const { data: org, error: orgError } = await service.from("organizations").insert({ name: `Train ${suffix}`, slug: `train-${suffix}`, is_demo: true, demo_seed_version: 1 }).select("id").single();
    if (orgError) throw orgError;
    const configured = await service.rpc("configure_train_signup", { p_organization_id: org.id, p_complimentary: true });
    if (configured.error) throw configured.error;
    const { data: facility, error: facilityError } = await service.from("facilities").insert({ organization_id: org.id, name: "Training-only PCH", facility_type: "PCH" }).select("id").single();
    if (facilityError) throw facilityError;
    const email = `train-${suffix}@test.local`, password = process.env.E2E_ACCOUNT_PASSWORD!;
    const { data: auth, error: authError } = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "org_admin", organization_id: org.id } });
    if (authError) throw authError;
    const role = await service.rpc("admin_update_profile", { p_user_id: auth.user!.id, p_role: "org_admin", p_is_active: true, p_organization_id: org.id });
    if (role.error) throw role.error;
    const { data: student, error: studentError } = await service.from("employees").insert({ organization_id: org.id, facility_id: facility.id, first_name: "Taylor", last_name: "Learner", job_title: "Direct care", hire_date: "2026-01-01", status: "active" }).select("id").single();
    if (studentError) throw studentError;

    await signInAs(page, email, password, "/app/train");
    await expect(page.getByRole("heading", { name: "CareMetric Train", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import students", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Students", exact: true }).click();
    await page.getByLabel("Training student").selectOption(student.id);
    await page.getByLabel("Direct care staff", { exact: true }).check();
    await page.getByLabel("Position and actual duties").fill("Assists with activities of daily living");
    await page.getByLabel("First work date at this facility").fill("2026-01-01");
    await page.getByRole("button", { name: "Confirm duties and audience" }).click();
    await expect(page.getByText("Training record saved", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Evidence", exact: true }).click();
    await page.getByLabel("Training title / content").fill("Resident rights instruction");
    await page.getByLabel("Completion date", { exact: true }).fill("2026-01-02");
    await page.getByLabel("Actual duration in minutes").fill("60");
    await page.getByLabel("Instructor / provider").fill("Qualified facility instructor");
    await page.getByLabel("Unique event or certificate reference").fill(`rights-${suffix}`);
    await page.getByLabel("Resident rights", { exact: true }).check();
    await page.getByLabel("Direct care annual", { exact: true }).fill("60");
    await page.getByRole("button", { name: "Save for review" }).click();
    await expect(page.getByText("Resident rights instruction · pending")).toBeVisible();
    await page.getByLabel("Review basis, qualifications and evidence checked").fill("Reviewed course content, attendance and instructor evidence");
    await page.getByRole("button", { name: "Record review" }).click();
    await expect(page.getByText("Resident rights instruction · verified")).toBeVisible();
    await page.getByRole("tab", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Taylor Learner", exact: true })).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV and evidence index" }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/^training-evidence-.*\.csv$/);
    await page.screenshot({ path: "test-results/standalone-train-report.png", fullPage: true });
    await page.goto("/app/residents");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app/train");

    const member = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const signedIn = await member.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    const denied = await member.rpc("can_read_clinical_record", { p_org: org.id, p_fac: facility.id });
    expect(denied.error).toBeNull(); expect(denied.data).toBe(false);
    const forbiddenGrant = await member.rpc("manage_module_access_term", { p_organization_id: org.id, p_module_key: "modules.carebase", p_source: "complimentary", p_reason: "Unauthorized self-upgrade attempt" });
    expect(forbiddenGrant.error).not.toBeNull();
  });
});
