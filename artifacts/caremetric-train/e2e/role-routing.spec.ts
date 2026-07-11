import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type TestRole =
  | "platform_admin"
  | "org_admin"
  | "facility_manager"
  | "trainer"
  | "auditor"
  | "employee";

interface TestAccount {
  id: string;
  email: string;
  password: string;
  expectedPath: string;
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const password = process.env.E2E_ACCOUNT_PASSWORD ?? "";
const guestEmail = "phase1-guest@test.local";
let verificationSlug: string;

let admin: SupabaseClient;
let organizationId: string;
let facilityId: string;
const accounts = new Map<TestRole, TestAccount>();

function requireEnvironment() {
  if (!supabaseUrl || !serviceRoleKey || !anonKey || !password) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY, and E2E_ACCOUNT_PASSWORD are required for the role browser suite",
    );
  }
}

async function createAccount(
  role: TestRole,
  expectedPath: string,
  suffix: string,
) {
  const email =
    "phase1-" + role.replace(/_/g, "-") + "-" + suffix + "@test.local";
  const appMetadata: Record<string, string> = { role };
  if (role !== "platform_admin") appMetadata.organization_id = organizationId;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: {
      first_name: "Phase",
      last_name: role,
    },
  });
  if (error || !data.user)
    throw error ?? new Error("User creation returned no user");

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      role,
      organization_id: role === "platform_admin" ? null : organizationId,
      is_active: true,
    })
    .eq("id", data.user.id);
  if (profileError) throw profileError;

  accounts.set(role, { id: data.user.id, email, password, expectedPath });
}

test.describe("role-aware release journeys", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    requireEnvironment();
    admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = String(Date.now());
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .insert({
        name: "Phase 1 Browser Test " + suffix,
        slug: "phase-1-browser-" + suffix,
        subscription_status: "active",
      })
      .select("id")
      .single();
    if (organizationError) throw organizationError;
    organizationId = organization.id;

    const { data: facility, error: facilityError } = await admin
      .from("facilities")
      .insert({
        organization_id: organizationId,
        name: "Phase 1 Browser Facility",
        facility_type: "PCH",
      })
      .select("id")
      .single();
    if (facilityError) throw facilityError;
    facilityId = facility.id;

    await createAccount("platform_admin", "/admin", suffix);
    await createAccount("org_admin", "/app", suffix);
    await createAccount("facility_manager", "/app", suffix);
    await createAccount("trainer", "/trainer", suffix);
    await createAccount("auditor", "/app", suffix);
    await createAccount("employee", "/me", suffix);

    const { data: guest, error: guestError } =
      await admin.auth.admin.createUser({
        email: guestEmail,
        password,
        email_confirm: true,
        app_metadata: { role: "auditor", organization_id: organizationId },
        user_metadata: { first_name: "Guest", last_name: "Auditor" },
      });
    if (guestError || !guest.user) {
      throw guestError ?? new Error("Guest user creation returned no user");
    }
    for (const role of ["facility_manager", "trainer"] as const) {
      const account = accounts.get(role)!;
      const { error } = await admin.from("facility_assignments").insert({
        profile_id: account.id,
        facility_id: facilityId,
      });
      if (error) throw error;
    }

    const employee = accounts.get("employee")!;
    const { error: employeeError } = await admin.from("employees").insert({
      organization_id: organizationId,
      facility_id: facilityId,
      profile_id: employee.id,
      first_name: "Phase",
      last_name: "Employee",
      email: employee.email,
      job_title: "Direct Care Worker",
      status: "active",
    });
    if (employeeError) throw employeeError;

    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({
        organization_id: organizationId,
        title: "Phase 1 Public Verification Course",
        // Verification only needs a stable course identity. Publishing without
        // a validated current version is deliberately rejected by the schema.
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
        title: "Phase 1 Public Verification Course v1",
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
      title: "Verification lesson",
      body: {
        content: "A release-gate fixture with publishable course content.",
      },
    });
    if (blockError) throw blockError;

    // A bare service-role table request is intentionally not a sanctioned
    // certificate write. Build this fixture through the same publish,
    // assignment, and atomic-completion commands used by production.
    const platform = accounts.get("platform_admin")!;
    const platformAuthClient = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInError } =
      await platformAuthClient.auth.signInWithPassword({
        email: platform.email,
        password,
      });
    if (signInError || !signInData.session) {
      throw signInError ?? new Error("Platform admin sign-in returned no session");
    }
    const platformClient = createClient(supabaseUrl!, anonKey!, {
      global: {
        headers: {
          Authorization: "Bearer " + signInData.session.access_token,
        },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: publishError } = await platformClient.rpc(
      "publish_course_version",
      { p_course_version_id: version.id },
    );
    if (publishError) throw publishError;

    const { data: assignment, error: assignmentError } = await platformClient
      .from("course_assignments")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        employee_id: employee.id,
        course_id: course.id,
        course_version_id: version.id,
        assigned_by: platform.id,
      })
      .select("id")
      .single();
    if (assignmentError) throw assignmentError;

    const { error: completionError } = await platformClient.rpc(
      "complete_course_assignment",
      { p_assignment_id: assignment.id },
    );
    if (completionError) throw completionError;

    const { data: certificate, error: certificateError } = await admin
      .from("certificates")
      .select("slug")
      .eq("course_assignment_id", assignment.id)
      .single();
    if (certificateError) throw certificateError;
    verificationSlug = certificate.slug;

    const { error: signOutError } = await platformAuthClient.auth.signOut();
    if (signOutError) throw signOutError;
  });

  test.afterAll(async () => {
    // CI runs this suite against a disposable stack that is stopped without a
    // backup. Retaining its fixtures avoids asking the test to delete immutable
    // audit evidence or regulated rows merely for cleanup.
  });

  test("anonymous visitors can verify a real certificate", async ({ page }) => {
    await page.goto(`/verify/${verificationSlug}`);
    await expect(page.getByText("Valid Certificate")).toBeVisible();
    await expect(page.getByText("Phase Employee")).toBeVisible();
    await expect(
      page.getByText("Phase 1 Public Verification Course"),
    ).toBeVisible();
  });

  test("configured guests can enter through the demo journey", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: /Guest auditor/ }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
      .toBe("/app");
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("anonymous users cannot open the system job control plane", async ({
    page,
  }) => {
    await page.goto("/admin/system-jobs");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
    await expect(
      page.getByRole("heading", { name: "Sign in to your account" }),
    ).toBeVisible();
  });

  for (const role of [
    "platform_admin",
    "org_admin",
    "facility_manager",
    "trainer",
    "auditor",
    "employee",
  ] as const) {
    test(role + " lands on the authorized home", async ({ page }) => {
      const account = accounts.get(role)!;
      await page.goto("/login");
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password").fill(account.password);
      await page.getByRole("button", { name: "Sign in" }).click();

      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
        .toBe(account.expectedPath);
      await expect(page.locator("h1").first()).toBeVisible();

      const accessibility = await new AxeBuilder({ page }).analyze();
      const criticalViolations = accessibility.violations.filter(
        (violation) => violation.impact === "critical",
      );
      expect(
        criticalViolations,
        JSON.stringify(criticalViolations, null, 2),
      ).toEqual([]);
    });
  }
});
