import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { hasLiveSupabaseEnv, signInAs } from "./helpers/auth";
import { facilityToday } from "./helpers/facilityDay";
import { totpCode } from "./helpers/totp";

type ManagerRole = "org_admin" | "facility_manager";
type Course = { id: string; versionId: string; title: string };
type Assignment = {
  id: string; employee_id: string; course_id: string; status: string; due_date: string | null;
  training_plan_id: string | null; completed_at: string | null; canceled_at: string | null;
};

async function signedClient(url: string, email: string, password: string) {
  const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/** Seed identities, facility rosters, and a local text-only catalog; create/apply/edit plans in the UI. */
async function fixtureFor(role: ManagerRole, url: string, password: string) {
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = crypto.randomUUID();
  const { data: org, error: orgError } = await service.from("organizations").insert({
    name: `Yearly plans ${role} ${suffix}`, slug: `yearly-plans-${suffix}`, is_demo: false,
  }).select("id").single();
  if (orgError) throw orgError;
  const { error: entitlementError } = await service.rpc("configure_train_signup", {
    p_organization_id: org.id, p_complimentary: true,
  });
  if (entitlementError) throw entitlementError;
  const { data: facilities, error: facilityError } = await service.from("facilities").insert([
    { organization_id: org.id, name: "Cedar yearly-plan facility", facility_type: "PCH" },
    { organization_id: org.id, name: "Aspen other facility", facility_type: "PCH" },
  ]).select("id,name");
  if (facilityError) throw facilityError;
  const facility = facilities.find(row => row.name === "Cedar yearly-plan facility")!;
  const otherFacility = facilities.find(row => row.name === "Aspen other facility")!;

  async function account(accountRole: ManagerRole | "platform_admin" | "employee") {
    const email = `yearly-${accountRole}-${suffix}@test.local`;
    const { data, error } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { role: accountRole, ...(accountRole === "platform_admin" ? {} : { organization_id: org.id }) },
      user_metadata: { first_name: "Yearly", last_name: accountRole },
    });
    if (error || !data.user) throw error ?? new Error("Fixture account was not created");
    const { error: profileError } = await service.rpc("admin_update_profile", {
      p_user_id: data.user.id, p_role: accountRole, p_is_active: true,
      ...(accountRole === "platform_admin" ? {} : { p_organization_id: org.id }),
    });
    if (profileError) throw profileError;
    return { id: data.user.id, email };
  }
  const manager = await account(role);
  const learner = await account("employee");
  const publisher = await account("platform_admin");
  // The normal facility-assignment trigger provisions the manager's builtin scope grant.
  const { error: scopeError } = await service.from("facility_assignments").insert({
    profile_id: manager.id, facility_id: facility.id,
  });
  if (scopeError) throw scopeError;
  const { data: employees, error: employeeError } = await service.from("employees").insert([
    { organization_id: org.id, facility_id: facility.id, profile_id: learner.id,
      first_name: "PlanFirst", last_name: "Learner", job_title: "Direct Care Worker", status: "active", hire_date: "2020-02-03" },
    { organization_id: org.id, facility_id: facility.id, profile_id: null,
      first_name: "PlanSecond", last_name: "Learner", job_title: "Direct Care Worker", status: "active", hire_date: "2025-08-21" },
    { organization_id: org.id, facility_id: otherFacility.id, profile_id: null,
      first_name: "OtherFacility", last_name: "Learner", job_title: "Direct Care Worker", status: "active", hire_date: "2024-05-09" },
  ]).select("id,first_name,facility_id");
  if (employeeError) throw employeeError;
  const first = employees.find(row => row.first_name === "PlanFirst")!;
  const second = employees.find(row => row.first_name === "PlanSecond")!;
  const publisherClient = await signedClient(url, publisher.email, password);
  const courses: Course[] = [];
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const title = `${name} yearly course ${suffix}`;
    const { data: course, error: courseError } = await service.from("courses").insert({
      organization_id: org.id, title, status: "draft", estimated_duration_minutes: 1,
    }).select("id").single();
    if (courseError) throw courseError;
    const { data: version, error: versionError } = await service.from("course_versions").insert({
      course_id: course.id, organization_id: org.id, title, version_number: 1, status: "draft", content_standard: "legacy",
    }).select("id").single();
    if (versionError) throw versionError;
    const { error: blockError } = await service.from("course_blocks").insert({
      course_version_id: version.id, organization_id: org.id, block_type: "text", sort_order: 0,
      title: `${name} classroom lesson`, body: { content: "Synthetic local classroom lesson for yearly plan regression coverage." },
    });
    if (blockError) throw blockError;
    const { error: publishError } = await publisherClient.rpc("publish_course_version", { p_course_version_id: version.id });
    if (publishError) throw publishError;
    const { error: activateError } = await publisherClient.from("courses").update({ status: "published" }).eq("id", course.id);
    if (activateError) throw activateError;
    courses.push({ id: course.id, versionId: version.id, title });
  }
  const year = Number(facilityToday().slice(0, 4)) + 1;
  const unrelatedDue = `${year}-09-09`;
  const { data: unrelated, error: unrelatedError } = await publisherClient.from("course_assignments").insert({
    organization_id: org.id, facility_id: facility.id, employee_id: first.id,
    course_id: courses[2].id, course_version_id: courses[2].versionId, assigned_by: publisher.id, due_date: unrelatedDue,
  }).select("id").single();
  if (unrelatedError) throw unrelatedError;
  await publisherClient.auth.signOut();
  return { organizationId: org.id, facility, otherFacility, manager, learner, first, second, courses,
    unrelatedId: unrelated.id, unrelatedDue, year, initialDue: `${year}-10-17`, changedDue: `${year}-11-23`,
    planName: `Yearly plan ${suffix}`, actorClient: await signedClient(url, manager.email, password) };
}

async function enrollMfa(page: Page) {
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

async function assignments(client: SupabaseClient, organizationId: string): Promise<Assignment[]> {
  const { data, error } = await client.from("course_assignments")
    .select("id,employee_id,course_id,status,due_date,training_plan_id,completed_at,canceled_at")
    .eq("organization_id", organizationId).order("id");
  if (error) throw error;
  return data;
}

async function addCourse(page: Page, title: string) {
  await page.getByRole("button", { name: "Add Item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Plan Item", exact: true });
  await dialog.getByRole("combobox", { name: "Training content *", exact: true }).click();
  await page.getByRole("option", { name: title, exact: true }).click();
  await dialog.getByRole("button", { name: "Add Item", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function applyToBoth(page: Page, name: string,
  counts: { assigned: number; updated: number; canceled: number; completed: number }, expectedConflict?: string) {
  await page.getByRole("button", { name: "Apply to Employee(s)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Apply "${name}" to Employees`, exact: true });
  await expect(dialog.getByRole("checkbox", { name: "OtherFacility Learner", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "PlanFirst Learner", exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "PlanSecond Learner", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Select all matching employees in this facility", exact: true }).check();
  await dialog.getByRole("button", { name: "Preview 2 Employees", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Assignment preview" })).toContainText("PlanFirst Learner");
  const applyButton = dialog.getByRole("button", { name: "Confirm apply to 2 Employees", exact: true });
  await applyButton.click();
  const result = dialog.getByRole("status");
  await expect(result).toContainText(`${counts.assigned} assignments created; ${counts.updated} deadlines updated; ${counts.canceled} removed-course assignments canceled; ${counts.completed} completed assignments preserved.`);
  if (expectedConflict) {
    await expect(result).toContainText(expectedConflict);
    await expect(result).toContainText("already assigned outside this plan");
    await expect(result.getByRole("listitem")).toHaveCount(1);
  } else {
    await expect(result).not.toContainText("Needs attention:");
  }
  // The shared dialog also has an X named Close. Select the footer beside Apply.
  await applyButton.locator("..").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test.describe("yearly facility training plans", () => {
  test.skip(!hasLiveSupabaseEnv(), "disposable local Supabase credentials required");

  for (const role of ["org_admin", "facility_manager"] as const) {
    test(`${role} chooses deadlines, applies and revises a bundle without changing other training`, async ({ page, browser }, testInfo) => {
      test.setTimeout(240_000);
      const url = process.env.SUPABASE_URL!;
      const baseURL = String(testInfo.project.use.baseURL);
      expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
      expect(new URL(baseURL).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
      const password = process.env.E2E_ACCOUNT_PASSWORD!;
      const f = await fixtureFor(role, url, password);
      page.setDefaultTimeout(15_000);
      const [alpha, beta, gamma] = f.courses;
      let planId = "";

      await test.step("create a facility/year plan with the administrator's exact deadline", async () => {
        await signInAs(page, f.manager.email, password, "/app/train");
        await enrollMfa(page);
        await expect(page.getByRole("heading", { name: "CareMetric Train", exact: true })).toBeVisible();
        await page.getByLabel("Training facility", { exact: true }).selectOption(f.facility.id);
        if (role === "facility_manager") {
          await expect(page.getByLabel("Training facility", { exact: true }).locator(`option[value="${f.otherFacility.id}"]`)).toHaveCount(0);
        }
        await page.getByRole("button", { name: "Build yearly plan", exact: true }).click();
        await expect(page.getByRole("tab", { name: "Learning Plans", exact: true })).toHaveAttribute("aria-selected", "true");
        await page.getByRole("button", { name: "New Plan", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "New Training Plan", exact: true });
        await expect(dialog.getByLabel("Facility *", { exact: true })).toHaveValue(f.facility.id);
        await expect(dialog.getByLabel("Facility *", { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel("Completion deadline *", { exact: true })).toHaveValue("");
        await dialog.getByLabel("Name *", { exact: true }).fill(f.planName);
        await dialog.getByLabel("Training year *", { exact: true }).fill(String(f.year));
        await expect(dialog.getByLabel("Completion deadline *", { exact: true })).toHaveValue("");
        await expect(dialog.getByRole("button", { name: "Create Plan", exact: true })).toBeDisabled();
        await dialog.getByLabel("Completion deadline *", { exact: true }).fill(f.initialDue);
        await dialog.getByRole("button", { name: "Create Plan", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        const { data: plan, error } = await f.actorClient.from("training_plans").select("id,facility_id,training_year,due_date")
          .eq("organization_id", f.organizationId).eq("name", f.planName).single();
        if (error) throw error;
        expect(plan).toMatchObject({ facility_id: f.facility.id, training_year: f.year, due_date: f.initialDue });
        planId = plan.id;
        await expect(page.getByRole("button", { name: f.planName, exact: true })).toHaveAttribute("aria-expanded", "true");
        await addCourse(page, alpha.title);
        await addCourse(page, beta.title);
        await applyToBoth(page, f.planName, { assigned: 4, updated: 0, canceled: 0, completed: 0 });
        const own = (await assignments(f.actorClient, f.organizationId)).filter(row => row.training_plan_id === planId);
        expect(own).toHaveLength(4);
        expect(own.map(row => `${row.employee_id}:${row.course_id}`).sort()).toEqual(
          [f.first.id, f.second.id].flatMap(id => [alpha.id, beta.id].map(courseId => `${id}:${courseId}`)).sort(),
        );
        expect(own.every(row => row.due_date === f.initialDue && row.status === "assigned")).toBe(true);
      });

      let completedBefore: Assignment;
      let certificateBefore: Record<string, unknown>;
      let unrelatedBefore: Assignment;
      await test.step("record one legitimate classroom completion before revising the plan", async () => {
        await page.getByRole("link", { name: "Assign courses / view progress", exact: true }).click();
        const row = page.getByRole("row").filter({ hasText: alpha.title }).filter({ hasText: "PlanFirst" });
        await row.getByRole("button", { name: "Mark Complete", exact: true }).click();
        await expect(row).toContainText("Completed");
        const rows = await assignments(f.actorClient, f.organizationId);
        completedBefore = rows.find(item => item.training_plan_id === planId && item.employee_id === f.first.id && item.course_id === alpha.id)!;
        expect(completedBefore.status).toBe("completed");
        expect(completedBefore.completed_at).toBeTruthy();
        unrelatedBefore = rows.find(item => item.id === f.unrelatedId)!;
        expect(unrelatedBefore).toMatchObject({ training_plan_id: null, due_date: f.unrelatedDue, status: "assigned" });
        const { data, error } = await f.actorClient.from("certificates").select("id,slug,issued_at,credential_number")
          .eq("course_assignment_id", completedBefore.id).single();
        if (error) throw error;
        certificateBefore = data;
        await page.getByRole("link", { name: "Back to training", exact: true }).click();
        await page.getByRole("tab", { name: "Learning Plans", exact: true }).click();
        await page.getByRole("button", { name: f.planName, exact: true }).click();
        await expect(page.getByRole("button", { name: f.planName, exact: true })).toHaveAttribute("aria-expanded", "true");
      });

      await test.step("edit the saved deadline and course bundle, then reapply to both employees", async () => {
        await page.getByRole("button", { name: `Edit ${f.planName}`, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Edit Training Plan", exact: true });
        await expect(dialog.getByLabel("Facility *", { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel("Training year *", { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel("Completion deadline *", { exact: true })).toHaveValue(f.initialDue);
        await dialog.getByLabel("Completion deadline *", { exact: true }).fill(f.changedDue);
        await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await page.getByText(beta.title, { exact: true }).locator("..").locator("..").getByRole("button", { name: "Remove item", exact: true }).click();
        const removal = page.getByRole("alertdialog", { name: "Remove Plan Item", exact: true });
        await removal.getByRole("button", { name: "Remove", exact: true }).click();
        await expect(removal).not.toBeVisible();
        await expect(page.getByText(beta.title, { exact: true })).toHaveCount(0);
        await addCourse(page, gamma.title);
        await applyToBoth(page, f.planName, { assigned: 1, updated: 1, canceled: 2, completed: 1 }, gamma.title);

        const rows = await assignments(f.actorClient, f.organizationId);
        expect(rows.find(row => row.id === completedBefore.id)).toEqual(completedBefore);
        expect(rows.find(row => row.id === f.unrelatedId)).toEqual(unrelatedBefore);
        const own = rows.filter(row => row.training_plan_id === planId);
        expect(own).toHaveLength(5);
        const canceled = own.filter(row => row.course_id === beta.id);
        expect(canceled).toHaveLength(2);
        expect(canceled.every(row => row.status === "canceled" && row.canceled_at)).toBe(true);
        expect(own.find(row => row.employee_id === f.second.id && row.course_id === alpha.id))
          .toMatchObject({ status: "assigned", due_date: f.changedDue });
        expect(own.find(row => row.employee_id === f.second.id && row.course_id === gamma.id))
          .toMatchObject({ status: "assigned", due_date: f.changedDue });
        expect(own.some(row => row.employee_id === f.first.id && row.course_id === gamma.id)).toBe(false);
        const { data: certificate, error: certificateError } = await f.actorClient.from("certificates")
          .select("id,slug,issued_at,credential_number").eq("course_assignment_id", completedBefore.id).single();
        if (certificateError) throw certificateError;
        expect(certificate).toEqual(certificateBefore);
        await applyToBoth(page, f.planName, { assigned: 0, updated: 0, canceled: 0, completed: 1 }, gamma.title);
        expect(await assignments(f.actorClient, f.organizationId)).toEqual(rows);
      });

      await test.step("an employee cannot manage or apply the yearly plan", async () => {
        const before = await assignments(f.actorClient, f.organizationId);
        const learnerClient = await signedClient(url, f.learner.email, password);
        const { error } = await learnerClient.rpc("apply_yearly_training_plan", { p_plan_id: planId, p_employee_id: f.first.id });
        expect(error?.code).toBe("42501");
        expect(error?.message).toBe("Training manager access required for this plan");
        expect(await assignments(f.actorClient, f.organizationId)).toEqual(before);
        const context = await browser.newContext({ baseURL });
        try {
          const employeePage = await context.newPage();
          // Both builds send this Train-only tenant to its course portal after login.
          await signInAs(employeePage, f.learner.email, password, "/me/courses");
          await expect(employeePage.getByRole("heading", { level: 1, name: "My Learning", exact: true })).toBeVisible();
          await employeePage.goto("/app/training-plans");
          // Role denial redirects to /me. Train's router then resolves that alias to courses;
          // the universal router renders the employee dashboard at /me itself.
          const standalone = process.env.PLAYWRIGHT_TRAIN_BUILD === "true";
          await expect.poll(() => new URL(employeePage.url()).pathname).toBe(standalone ? "/me/courses" : "/me");
          await expect(employeePage.getByRole("heading", { level: 1, name: standalone ? "My Learning" : "My day", exact: true })).toBeVisible();
          await expect(employeePage.getByRole("button", { name: "New Plan", exact: true })).toHaveCount(0);
        } finally {
          await context.close();
          await learnerClient.auth.signOut();
        }
      });
      await f.actorClient.auth.signOut();
      // The disposable local stack retains immutable completion/certificate evidence until teardown.
    });
  }
});
