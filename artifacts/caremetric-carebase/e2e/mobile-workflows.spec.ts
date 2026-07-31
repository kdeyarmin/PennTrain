/**
 * Mobile viewport workflows (Pixel 5 via playwright project `mobile-chrome`).
 *
 * Public paths always run. Authenticated paths require the same live Supabase
 * env as role-routing.spec.ts and are skipped when that env is absent so local
 * typecheck/test and CI without secrets stay green.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  expectNoHorizontalOverflow,
  hasLiveSupabaseEnv,
  requireLiveSupabaseEnv,
  signInAs,
} from "./helpers/auth";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const password = process.env.E2E_ACCOUNT_PASSWORD ?? "";

test.describe("mobile public surfaces", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("landing has no horizontal overflow and primary CTAs remain usable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("link", { name: "Start a Free Trial" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Log In" }).first()).toBeVisible();
  });

  test("login form is usable on a phone-width viewport", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("safety report walk-up is usable without a facility code", async ({ page }) => {
    await page.goto("/report-safety");
    await expect(page.getByText(/safety|report|facility/i).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("mobile authenticated employee workflows", () => {
  test.skip(!hasLiveSupabaseEnv(), "live Supabase credentials required");

  test.describe.configure({ mode: "serial" });

  let admin: SupabaseClient;
  let organizationId: string;
  let facilityId: string;
  let employeeEmail: string;
  let employeePassword: string;
  let assignmentId: string;

  test.beforeAll(async () => {
    requireLiveSupabaseEnv();
    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const suffix = `mobile-${Date.now()}`;
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: `Mobile E2E ${suffix}`,
        slug: `mobile-e2e-${suffix}`,
        subscription_status: "active",
      })
      .select("id")
      .single();
    if (orgError) throw orgError;
    organizationId = org.id;

    const { data: facility, error: facilityError } = await admin
      .from("facilities")
      .insert({
        organization_id: organizationId,
        name: "Mobile E2E Facility",
        facility_type: "PCH",
      })
      .select("id")
      .single();
    if (facilityError) throw facilityError;
    facilityId = facility.id;

    employeeEmail = `mobile-employee-${suffix}@test.local`;
    employeePassword = password;
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email: employeeEmail,
      password: employeePassword,
      email_confirm: true,
      app_metadata: { role: "employee", organization_id: organizationId },
      user_metadata: { first_name: "Mobile", last_name: "Employee" },
    });
    if (userError || !user.user) throw userError ?? new Error("no user");

    const { error: profileError } = await admin.rpc("admin_update_profile", {
      p_user_id: user.user.id,
      p_role: "employee",
      p_is_active: true,
      p_organization_id: organizationId,
    });
    if (profileError) throw profileError;

    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        profile_id: user.user.id,
        first_name: "Mobile",
        last_name: "Employee",
        email: employeeEmail,
        job_title: "Direct Care Worker",
        status: "active",
      })
      .select("id")
      .single();
    if (employeeError) throw employeeError;

    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({
        organization_id: organizationId,
        title: "Mobile E2E Course",
        status: "draft",
      })
      .select("id")
      .single();
    if (courseError) throw courseError;

    const { data: version, error: versionError } = await admin
      .from("course_versions")
      .insert({
        course_id: course.id,
        organization_id: organizationId,
        version_number: 1,
        title: "Mobile E2E Course v1",
        status: "draft",
      })
      .select("id")
      .single();
    if (versionError) throw versionError;

    const { error: blockError } = await admin.from("course_blocks").insert({
      course_version_id: version.id,
      organization_id: organizationId,
      block_type: "text",
      sort_order: 0,
      title: "Mobile lesson",
      body: { content: "Mobile learner content." },
    });
    if (blockError) throw blockError;

    // Service-role publish helpers may vary; prefer table updates for fixture speed.
    await admin.from("course_versions").update({ status: "published" }).eq("id", version.id);
    await admin.from("courses").update({ status: "published", current_version_id: version.id }).eq("id", course.id);

    const { data: assignment, error: assignmentError } = await admin
      .from("course_assignments")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        employee_id: employee.id,
        course_id: course.id,
        course_version_id: version.id,
        assigned_by: user.user.id,
      })
      .select("id")
      .single();
    if (assignmentError) throw assignmentError;
    assignmentId = assignment.id;
  });

  async function employeeHome(page: Page) {
    await signInAs(page, employeeEmail, employeePassword, /^\/me(?:\/courses)?$/);
  }

  test("employee shift surface fits mobile and exposes primary actions", async ({ page }) => {
    await employeeHome(page);
    await page.goto("/me/shift");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
    const critical = (await new AxeBuilder({ page }).analyze()).violations
      .filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  test("employee can open an assigned course on mobile", async ({ page }) => {
    await employeeHome(page);
    await page.goto(`/me/courses/${assignmentId}`);
    await expect(page.getByText(/Mobile lesson|Mobile E2E Course|lesson/i).first()).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("employee services queue is usable on mobile", async ({ page }) => {
    await employeeHome(page);
    await page.goto("/me/services");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("employee change-of-condition list is usable on mobile", async ({ page }) => {
    await employeeHome(page);
    await page.goto("/me/change-of-condition");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
  });
});
