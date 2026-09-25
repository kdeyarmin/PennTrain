/**
 * Real-backend navigation inventory. These are independent expectations, not a runtime parse of
 * App.tsx: changing a route's role gate cannot silently change what this suite expects to allow.
 * Record-specific mutations are exercised by role-routing, resident-lifecycle and Train journeys.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { gotoAppRoute, hasLiveSupabaseEnv, requireLiveSupabaseEnv, signInAs } from "./helpers/auth";
import { totpCode } from "./helpers/totp";

const ROLES = ["platform_admin", "org_admin", "facility_manager", "trainer", "auditor", "employee"] as const;
type Role = typeof ROLES[number];
const PLATFORM: readonly Role[] = ["platform_admin"];
const MANAGERS: readonly Role[] = ["org_admin", "facility_manager"];
const ORG: readonly Role[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const REVIEWERS: readonly Role[] = ["org_admin", "facility_manager", "auditor"];
const OPERATIONS: readonly Role[] = ["platform_admin", ...REVIEWERS];
const NON_EMPLOYEE: readonly Role[] = ["platform_admin", ...ORG];
const TRAINERS: readonly Role[] = ["trainer", ...MANAGERS];
const EMPLOYEE: readonly Role[] = ["employee"];

type Destination = readonly [path: string, heading: RegExp, roles: readonly Role[]];
const DESTINATIONS: readonly Destination[] = [
  ["/account/security", /Multi-factor authentication/i, ROLES],
  ["/account/notifications", /Notification settings/i, ROLES],
  ["/account/announcements", /Announcements/i, ROLES],
  ["/account/whats-new", /What.s new/i, ROLES],
  ["/admin", /Platform Dashboard/i, PLATFORM],
  ["/admin/training-reports", /Facility training reports/i, PLATFORM],
  ["/admin/organizations", /Organizations/i, PLATFORM],
  ["/admin/users", /Users/i, PLATFORM],
  ["/admin/audit", /Audit Log/i, PLATFORM],
  ["/admin/facilities", /Facilities/i, PLATFORM],
  ["/admin/employees", /Employees/i, PLATFORM],
  ["/admin/alerts", /Alerts/i, PLATFORM],
  ["/admin/packages", /Packages & billing/i, PLATFORM],
  ["/admin/courses", /Training Content/i, PLATFORM],
  ["/admin/courses/new-ai", /Generate Courses with AI/i, PLATFORM],
  ["/admin/ai-generations", /AI Generation Log/i, PLATFORM],
  ["/admin/training-plans", /Training Plans/i, PLATFORM],
  ["/admin/notifications", /Notification Deliveries/i, PLATFORM],
  ["/admin/system-jobs", /System Jobs/i, PLATFORM],
  ["/admin/enterprise", /Enterprise foundation/i, PLATFORM],
  ["/admin/qualified-workforce", /Qualified workforce operations/i, PLATFORM],
  ["/admin/governed-learning", /Governed content and training/i, PLATFORM],
  ["/admin/closed-loop-compliance", /Closed-loop compliance and documentation/i, PLATFORM],
  ["/admin/regulatory-copilot", /Citation-Backed Regulatory Copilot/i, PLATFORM],
  ["/admin/settings", /Platform Settings/i, PLATFORM],
  ["/admin/security", /Security & Governance/i, PLATFORM],
  ["/admin/release-flags", /Release Flags/i, PLATFORM],
  ["/admin/support-tickets", /Support Tickets/i, PLATFORM],
  ["/admin/help-content", /Help Center Content/i, PLATFORM],
  ["/admin/regulatory-updates", /Regulatory Updates/i, PLATFORM],
  ["/admin/document-analyzer", /State Form Document Analyzer/i, PLATFORM],
  ["/admin/roadmap", /Shipped capabilities/i, PLATFORM],
  ["/app", /Compliance scorecard/i, ORG],
  ["/app/today", /Today/i, REVIEWERS],
  ["/app/value-center", /CareBase Value Center/i, MANAGERS],
  ["/app/facilities", /Facilities/i, ORG],
  ["/app/employees", /Employees/i, ORG],
  ["/app/data-imports", /Import and Data Migration Center/i, MANAGERS],
  ["/app/invitations", /Invitation lifecycle/i, OPERATIONS],
  ["/app/employee-lifecycle", /Employee lifecycle cases/i, MANAGERS],
  ["/app/train", /CareMetric Train/i, ORG],
  ["/app/training-matrix", /Training Matrix/i, ORG],
  ["/app/training-types", /Training Types/i, MANAGERS],
  ["/app/courses", /Training Content/i, ORG],
  ["/app/course-assignments", /Training Assignments/i, ORG],
  ["/app/training-plans", /Training Plans/i, ORG],
  ["/app/competency-templates", /Competency Templates/i, ORG],
  ["/app/competency-records", /Competency Records/i, ORG],
  ["/app/compliance-binder", /Compliance Binder/i, REVIEWERS],
  ["/app/compliance-command-center", /Compliance Command Center/i, REVIEWERS],
  ["/app/inspection-readiness", /Inspection readiness/i, REVIEWERS],
  ["/app/survey-day", /Survey Day/i, REVIEWERS],
  ["/app/survey-rehearsals", /Survey rehearsal & random sampling/i, REVIEWERS],
  ["/app/pch-alr-operations", /PCH \/ ALF Operations Center/i, REVIEWERS],
  ["/app/shift-handoffs", /Shift Handoff Inbox/i, MANAGERS],
  ["/app/regulatory-crosswalk", /Chapter 2600 \/ 2800 Regulatory Crosswalk/i, REVIEWERS],
  ["/app/regulatory-copilot", /Citation-Backed Regulatory Copilot/i, REVIEWERS],
  ["/app/practicums", /Annual Practicums/i, ORG],
  ["/app/med-admin-roster", /Who Can Pass Meds Today/i, ORG],
  ["/app/medication-integration", /Medication Integration/i, OPERATIONS],
  ["/app/fhir-integration", /FHIR Integration/i, OPERATIONS],
  ["/app/credentials", /Credentials & Clearances/i, REVIEWERS],
  ["/app/background-checks", /Background Checks/i, REVIEWERS],
  ["/app/administrator-qualification", /Administrator Qualification & CE/i, MANAGERS],
  ["/app/policy-documents", /Policies & Procedures/i, REVIEWERS],
  ["/app/my-attestations", /My Attestations/i, NON_EMPLOYEE],
  ["/app/template-documents", /Template Documents/i, REVIEWERS],
  ["/app/dhs-forms", /DHS Forms Library/i, REVIEWERS],
  ["/app/incidents", /Incidents & Complaints/i, REVIEWERS],
  ["/app/report-event", /Report an event/i, REVIEWERS],
  ["/app/complaints", /Complaints, Grievances & Resident Rights/i, REVIEWERS],
  ["/app/confidential-incidents", /Confidential Reports/i, OPERATIONS],
  ["/app/work", /Work/i, OPERATIONS],
  ["/app/evidence", /Documentation Room/i, OPERATIONS],
  ["/app/guest-access", /Guest access center/i, OPERATIONS],
  ["/app/violations", /Violations & Plans of Correction/i, REVIEWERS],
  ["/app/residents", /Residents/i, REVIEWERS],
  ["/app/resident-compliance", /Resident Compliance/i, REVIEWERS],
  ["/app/state-forms", /State Forms/i, REVIEWERS],
  ["/app/services", /Resident Service Delivery/i, OPERATIONS],
  ["/app/resident-care-delivery", /Resident Care Delivery/i, OPERATIONS],
  ["/app/admissions", /Admissions, Census & Rooms/i, OPERATIONS],
  ["/app/change-of-condition", /Change-of-Condition Management/i, OPERATIONS],
  ["/app/dietary-operations", /Dietary & Food-Safety Operations/i, OPERATIONS],
  ["/app/resident-services-calendar", /Resident Services Calendar/i, OPERATIONS],
  ["/app/resident-finance", /Resident Financial Operations/i, OPERATIONS],
  ["/app/qapi", /QAPI & Quality Management/i, OPERATIONS],
  ["/app/emergency", /Emergency Operations/i, OPERATIONS],
  ["/app/inspections", /Inspections & Equipment/i, ORG],
  ["/app/maintenance", /Maintenance & Work Orders/i, NON_EMPLOYEE],
  ["/app/alerts", /Alerts/i, ORG],
  ["/app/reports/comprehensive", /Comprehensive Report/i, REVIEWERS],
  ["/app/reports", /Compliance Reports/i, REVIEWERS],
  ["/app/documents", /Documents/i, ORG],
  ["/app/pending-approvals", /Pending Approvals/i, TRAINERS],
  ["/app/users", /Users/i, MANAGERS],
  ["/app/settings", /Settings/i, MANAGERS],
  ["/app/billing", /Billing & plans/i, ["org_admin"]],
  ["/app/enterprise", /Enterprise foundation/i, ["org_admin"]],
  ["/app/workforce-operations", /Qualified workforce operations/i, MANAGERS],
  ["/app/governed-learning", /Governed content and training/i, MANAGERS],
  ["/app/closed-loop-compliance", /Closed-loop compliance and documentation/i, REVIEWERS],
  ["/app/audit", /Audit Log/i, REVIEWERS],
  ["/app/help", /Help Center/i, ORG],
  ["/app/schedule", /Schedule/i, MANAGERS],
  ["/app/schedule/setup", /Scheduling Setup/i, MANAGERS],
  ["/trainer", /Trainer Dashboard/i, ["trainer"]],
  ["/trainer/gaps", /Training gaps/i, ["trainer"]],
  ["/trainer/classes", /Training Classes/i, TRAINERS],
  ["/trainer/retraining", /Retraining Monitor/i, ["trainer"]],
  ["/trainer/facilities", /Facilities/i, ["trainer"]],
  ["/trainer/employees", /Employees/i, ["trainer"]],
  ["/me", /My day/i, EMPLOYEE],
  ["/me/trainings", /My Training Records/i, EMPLOYEE],
  ["/me/work", /Work/i, EMPLOYEE],
  ["/me/floor", /Floor/i, EMPLOYEE],
  ["/me/residents", /Resident Chart/i, EMPLOYEE],
  ["/me/services", /My Services/i, EMPLOYEE],
  ["/me/change-of-condition", /My Change Follow-Ups/i, EMPLOYEE],
  ["/me/dietary-operations", /Dietary & Food-Safety Operations/i, EMPLOYEE],
  ["/me/resident-services-calendar", /Resident Services Calendar/i, EMPLOYEE],
  ["/me/shift", /My Shift/i, EMPLOYEE],
  ["/me/schedule", /My Schedule/i, EMPLOYEE],
  ["/me/certificates", /My Certificates/i, EMPLOYEE],
  ["/me/courses", /My Training/i, ROLES],
  ["/me/documents", /Documents/i, EMPLOYEE],
  ["/me/credentials", /My Credentials/i, ["employee", "trainer"]],
  ["/me/attestations", /My Attestations/i, EMPLOYEE],
  ["/me/help", /Help Center/i, EMPLOYEE],
];

// Sensitive boundaries use different route families: tenant setup, billing, resident data,
// confidential reports, employment clearances, operational queues and employee-only records.
const DENIED: Record<Role, readonly string[]> = {
  platform_admin: ["/app/billing", "/app/settings", "/trainer", "/me/shift", "/me/credentials"],
  org_admin: ["/admin/users", "/admin/packages", "/trainer", "/me/shift", "/me/credentials"],
  facility_manager: ["/admin/users", "/app/billing", "/app/enterprise", "/trainer", "/me/shift"],
  trainer: ["/admin/users", "/app/settings", "/app/billing", "/app/credentials", "/app/incidents", "/app/residents", "/app/confidential-incidents", "/app/guest-access", "/me/shift"],
  auditor: ["/admin/users", "/app/users", "/app/settings", "/app/billing", "/app/pending-approvals", "/app/schedule", "/trainer/classes", "/me/shift"],
  employee: ["/admin/users", "/app/users", "/app/billing", "/app/credentials", "/app/incidents", "/app/residents", "/app/confidential-incidents", "/app/guest-access", "/trainer/classes"],
};

const HOMES: Record<Role, string> = {
  platform_admin: "/admin", org_admin: "/app/today", facility_manager: "/app/today",
  trainer: "/trainer", auditor: "/app/today", employee: "/me",
};

async function enrollRequiredMfa(page: Page) {
  await expect(page.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
  await page.getByRole("link", { name: "Open account security" }).click();
  await page.getByRole("button", { name: "Add authenticator app", exact: true }).click();
  const setupKey = page.getByText("Manual setup key", { exact: true }).locator("..").locator("code");
  await expect(setupKey).toBeVisible();
  await page.getByLabel("Authenticator code", { exact: true }).fill(totpCode((await setupKey.innerText()).trim()));
  await page.getByRole("button", { name: "Verify authenticator", exact: true }).click();
  await expect(page.getByText(/This session is already verified/)).toBeVisible();
  await page.getByRole("button", { name: "Continue to the page you were opening" }).click();
}

test.describe("all role navigation and sensitive route boundaries", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase credentials required");

  // Deliberately not serial: a broken route for one role must not skip every subsequent role.
  for (const role of ROLES) {
    const destinations = DESTINATIONS.filter(([, , roles]) => roles.includes(role));
    test(`${role}: ${destinations.length} authorized destinations and ${DENIED[role].length} denied destinations`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
      requireLiveSupabaseEnv();
      const supabaseUrl = process.env.SUPABASE_URL!;
      const browserUrl = test.info().project.use.baseURL;
      const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
      if (!browserUrl || ![supabaseUrl, browserUrl].every(url => loopbackHosts.includes(new URL(url).hostname))) {
        throw new Error("Navigation fixtures require both a local app and disposable local Supabase");
      }
      const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const suffix = randomUUID();
      const email = `navigation-${role}-${suffix}@test.local`;
      const password = process.env.E2E_ACCOUNT_PASSWORD!;
      const { data: org, error: orgError } = await admin.from("organizations").insert({
        name: `Navigation ${role} ${suffix}`, slug: `navigation-${suffix}`, subscription_status: "active",
      }).select("id").single();
      if (orgError) throw orgError;
      const { data: facility, error: facilityError } = await admin.from("facilities").insert({
        organization_id: org.id, name: "Navigation PCH", facility_type: "PCH",
      }).select("id").single();
      if (facilityError) throw facilityError;
      const { data: account, error: accountError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { role, ...(role === "platform_admin" ? {} : { organization_id: org.id }) },
        user_metadata: { first_name: "Navigation", last_name: role },
      });
      if (accountError || !account.user) throw accountError ?? new Error("Account was not created");
      const { error: profileError } = await admin.rpc("admin_update_profile", {
        p_user_id: account.user.id, p_role: role, p_is_active: true,
        ...(role === "platform_admin" ? {} : { p_organization_id: org.id }),
      });
      if (profileError) throw profileError;
      if (["org_admin", "facility_manager", "trainer"].includes(role)) {
        const { error } = await admin.from("facility_assignments").insert({
          profile_id: account.user.id, facility_id: facility.id,
        });
        if (error) throw error;
      }
      if (role === "employee" || role === "trainer") {
        const { error } = await admin.from("employees").insert({
          organization_id: org.id, facility_id: facility.id, profile_id: account.user.id,
          first_name: "Navigation", last_name: role, email, job_title: "Direct Care Worker", status: "active",
        });
        if (error) throw error;
      }

      const runtimeErrors: string[] = [];
      const queryErrors: string[] = [];
      page.on("pageerror", error => runtimeErrors.push(error.message));
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.origin === new URL(supabaseUrl).origin && url.pathname.startsWith("/rest/v1/") && response.status() >= 400) {
          queryErrors.push(`${response.status()} ${url.pathname}`);
        }
      });
      await signInAs(page, email, password, HOMES[role]);
      if (["platform_admin", "org_admin", "facility_manager"].includes(role)) await enrollRequiredMfa(page);

      // Keep visiting after a single route fails so one spinner cannot hide dozens of other
      // broken destinations. Playwright still marks the role test failed and retains its trace.
      async function visitStep(label: string, visit: () => Promise<void>) {
        try {
          await test.step(label, visit);
        } catch (error) {
          await test.info().attach(label.replace(/[^a-z0-9]+/gi, "-"), {
            body: await page.screenshot(), contentType: "image/png",
          });
          expect.soft(error instanceof Error ? error.message : String(error), label).toBeUndefined();
        }
      }

      for (const [path, heading] of destinations) {
        await visitStep(`open ${path}`, async () => {
          const { mfaGated } = await gotoAppRoute(page, path, 25_000);
          expect.soft(mfaGated, `${path} must render after MFA verification`).toBe(false);
          await expect.soft.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toBe(path);
          await expect.soft(page.locator("main#main-content h1").first()).toHaveText(heading, { timeout: 15_000 });
          // Do not accept the title alone while a failed query is still about to replace its data.
          await page.waitForLoadState("networkidle", { timeout: 15_000 });
          await expect.soft(page.locator('main#main-content [aria-busy="true"]')).toHaveCount(0);
          await expect.soft(page.locator("main#main-content").getByText(/^(?:Couldn.t load|Could not load|Failed to load|Something went wrong)/)).toHaveCount(0);
          expect.soft(runtimeErrors.splice(0), `uncaught browser errors on ${path}`).toEqual([]);
          expect.soft(queryErrors.splice(0), `failed data queries on ${path}`).toEqual([]);
        });
      }

      const denialHome = ["org_admin", "facility_manager", "auditor"].includes(role) ? "/app" : HOMES[role];
      for (const path of DENIED[role]) {
        await visitStep(`deny ${path}`, async () => {
          const { mfaGated } = await gotoAppRoute(page, path, 25_000);
          expect.soft(mfaGated, "denial must be the role guard, not an unverified session").toBe(false);
          await expect.soft.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toBe(denialHome);
          const home = DESTINATIONS.find(([route]) => route === denialHome)!;
          await expect.soft(page.locator("main#main-content h1").first()).toHaveText(home[1]);
        });
      }
    });
  }
});
