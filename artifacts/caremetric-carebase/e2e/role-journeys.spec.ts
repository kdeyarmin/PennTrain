/**
 * Authenticated happy-path journeys per role beyond home landing
 * (role-routing.spec.ts already covers home + several deep paths).
 *
 * Requires live Supabase env; skipped otherwise.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  expectNoHorizontalOverflow,
  gotoAppRoute,
  hasLiveSupabaseEnv,
  requireLiveSupabaseEnv,
  signInAs,
} from "./helpers/auth";

type Role =
  | "platform_admin"
  | "org_admin"
  | "facility_manager"
  | "trainer"
  | "auditor"
  | "employee";

interface Account {
  id: string;
  email: string;
  password: string;
  home: string;
}

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const password = process.env.E2E_ACCOUNT_PASSWORD ?? "";

const JOURNEYS: Record<Role, { path: string; heading?: RegExp }[]> = {
  platform_admin: [
    { path: "/admin", heading: /dashboard|platform|organizations/i },
    { path: "/admin/organizations", heading: /organization/i },
    { path: "/admin/system-jobs", heading: /job|system/i },
  ],
  org_admin: [
    { path: "/app/today", heading: /today|home|priorit/i },
    { path: "/app", heading: /dashboard|compliance|action/i },
    { path: "/app/employees", heading: /employee/i },
    { path: "/app/incidents", heading: /incident/i },
    { path: "/app/work", heading: /work/i },
    { path: "/app/guest-access", heading: /guest/i },
  ],
  facility_manager: [
    { path: "/app/today", heading: /today|home|priorit/i },
    { path: "/app/residents", heading: /resident/i },
    { path: "/app/work", heading: /work/i },
    { path: "/app/confidential-incidents", heading: /confidential|report/i },
  ],
  trainer: [
    { path: "/trainer", heading: /trainer|class|dashboard/i },
    { path: "/trainer/classes", heading: /class/i },
    { path: "/app/courses", heading: /course|training|content/i },
  ],
  auditor: [
    { path: "/app/today", heading: /today|home|priorit|audit/i },
    { path: "/app/compliance-binder", heading: /binder/i },
    { path: "/app/evidence", heading: /documentation|evidence/i },
    { path: "/app/audit", heading: /audit/i },
  ],
  employee: [
    { path: "/me", heading: /my|work|training|dashboard/i },
    { path: "/me/courses", heading: /training|course|assignment/i },
    { path: "/me/shift", heading: /shift/i },
    { path: "/me/work", heading: /work/i },
    // Caregiver clinical charting. The employee role reaches resident data only through the
    // clinical SECURITY DEFINER RPCs, never through residents RLS, so this route rendering at all
    // for this role is the thing worth asserting in a browser.
    { path: "/me/residents", heading: /resident chart/i },
  ],
};

test.describe("authenticated role journeys", () => {
  test.skip(!hasLiveSupabaseEnv(), "live Supabase credentials required");
  test.describe.configure({ mode: "serial" });

  let admin: SupabaseClient;
  let organizationId: string;
  let facilityId: string;
  const accounts = new Map<Role, Account>();

  test.beforeAll(async () => {
    requireLiveSupabaseEnv();
    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const suffix = `journey-${Date.now()}`;
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: `Journey E2E ${suffix}`,
        slug: `journey-e2e-${suffix}`,
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
        name: "Journey Facility",
        facility_type: "PCH",
      })
      .select("id")
      .single();
    if (facilityError) throw facilityError;
    facilityId = facility.id;

    const homes: Record<Role, string> = {
      platform_admin: "/admin",
      org_admin: "/app/today",
      facility_manager: "/app/today",
      trainer: "/trainer",
      auditor: "/app/today",
      employee: "/me",
    };

    for (const role of Object.keys(homes) as Role[]) {
      const email = `journey-${role.replace(/_/g, "-")}-${suffix}@test.local`;
      const appMetadata: Record<string, string> = { role };
      if (role !== "platform_admin") appMetadata.organization_id = organizationId;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: { first_name: "Journey", last_name: role },
      });
      if (error || !data.user) throw error ?? new Error("no user");
      const { error: profileError } = await admin.rpc("admin_update_profile", {
        p_user_id: data.user.id,
        p_role: role,
        p_is_active: true,
        ...(role === "platform_admin" ? {} : { p_organization_id: organizationId }),
      });
      if (profileError) throw profileError;
      accounts.set(role, { id: data.user.id, email, password, home: homes[role] });
    }

    for (const role of ["org_admin", "facility_manager", "trainer"] as const) {
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
      first_name: "Journey",
      last_name: "Employee",
      email: employee.email,
      job_title: "Direct Care Worker",
      status: "active",
    });
    if (employeeError) throw employeeError;
  });

  for (const role of Object.keys(JOURNEYS) as Role[]) {
    test(`${role} can open core workflow destinations`, async ({ page }) => {
      const account = accounts.get(role)!;
      // Privileged roles may land on MFA gate; for this suite we only enroll org_admin
      // in role-routing. Here we accept either home or MFA gate, then navigate paths
      // that do not require AAL2 when possible.
      await page.goto("/login");
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password").fill(account.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).not.toBe("/login");

      const mfaGate = page.getByText(/multi-factor verification required/i);
      if (await mfaGate.isVisible().catch(() => false)) {
        // MFA-gated roles: verify gate is present and stop (full AAL2 covered in role-routing).
        await expect(mfaGate).toBeVisible();
        return;
      }

      for (const step of JOURNEYS[role]) {
        // MfaPolicyGate renders its children while the policy query is still unresolved
        // (`mustVerify` is falsy until `policy.data` arrives), so on a privileged route the page
        // content paints first and the MFA screen replaces it a moment later. Checking the gate
        // once before this loop is therefore not enough, and checking it immediately after
        // navigation only narrows the window rather than closing it.
        //
        // Waiting for *either* outcome closes it: the route's h1, or the gate's own level-1
        // heading. Whichever settles is the real state of the page. gotoAppRoute applies the same
        // rule to the shell itself and reports which one it found, so a policy that resolves
        // during navigation is handled there rather than timing out on a shell the app unmounted.
        const { mfaGated } = await gotoAppRoute(page, step.path);
        if (mfaGated) {
          await expect(mfaGate).toBeVisible();
          return;
        }

        const routeHeading = page.locator("h1").first();
        await expect(routeHeading.or(mfaGate)).toBeVisible({ timeout: 20_000 });
        if (await mfaGate.isVisible().catch(() => false)) {
          await expect(mfaGate).toBeVisible();
          return;
        }

        await expect(routeHeading).toBeVisible({ timeout: 20_000 });
        if (step.heading) {
          await expect(page.locator("body")).toContainText(step.heading);
        }
        await expectNoHorizontalOverflow(page);
      }

      const critical = (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === "critical");
      expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
    });
  }
});
