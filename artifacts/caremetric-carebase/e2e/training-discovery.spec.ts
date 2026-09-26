import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, hasLiveSupabaseEnv, signInAs } from "./helpers/auth";
import { totpCode } from "./helpers/totp";

async function verifyNewAdministrator(page: Page) {
  await expect(page.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
  await page.getByRole("link", { name: "Open account security" }).click();
  await page.getByRole("button", { name: "Add authenticator app", exact: true }).click();
  const key = page.getByText("Manual setup key", { exact: true }).locator("..").locator("code");
  await expect(key).toBeVisible();
  await page.getByLabel("Authenticator code", { exact: true }).fill(totpCode((await key.innerText()).trim()));
  const response = page.waitForResponse(value => value.url().includes("/auth/v1/factors/") && value.url().endsWith("/verify") && value.request().method() === "POST");
  await page.getByRole("button", { name: "Verify authenticator", exact: true }).click();
  const session = await (await response).json() as { access_token: string; refresh_token: string };
  await expect(page.getByText(/This session is already verified/)).toBeVisible();
  await page.getByRole("button", { name: "Continue to the page you were opening" }).click();
  return session;
}

test.describe("optional course discovery and refresher practice", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase test credentials required");
  test("owner curation, saved electives and optional practice are visible without changing required evidence", async ({ page, browser }, testInfo) => {
    test.setTimeout(300_000);
    test.skip(process.env.PLAYWRIGHT_TRAIN_BUILD === "true", "global content authoring uses the universal owner console");
    const url = process.env.SUPABASE_URL!, password = process.env.E2E_ACCOUNT_PASSWORD!;
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(new URL(String(testInfo.project.use.baseURL)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const suffix = crypto.randomUUID(), courseTitle = `Discovery communication ${suffix}`, collectionTitle = `Communication collection ${suffix}`, lessonTitle = `Communication refresher ${suffix}`;
    const { data: org, error: orgError } = await service.from("organizations").insert({ name: `Discovery partner ${suffix}`, slug: `discovery-${suffix}`, is_demo: false }).select("id").single();
    if (orgError) throw orgError;
    const { error: entitlementError } = await service.rpc("configure_train_signup", { p_organization_id: org.id, p_complimentary: true });
    if (entitlementError) throw entitlementError;
    const { data: facility, error: facilityError } = await service.from("facilities").insert({ organization_id: org.id, name: "Discovery training facility", facility_type: "PCH" }).select("id").single();
    if (facilityError) throw facilityError;
    async function account(role: "platform_admin" | "org_admin" | "employee") {
      const email = `discovery-${role}-${suffix}@test.local`;
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true,
        app_metadata: { role, ...(role === "platform_admin" ? {} : { organization_id: org.id }) },
        user_metadata: { first_name: "Discovery", last_name: role === "employee" ? "Learner" : "Administrator" } });
      if (error || !data.user) throw error || new Error("Disposable account was not created");
      const { error: profileError } = await service.rpc("admin_update_profile", { p_user_id: data.user.id, p_role: role, p_is_active: true,
        ...(role === "platform_admin" ? {} : { p_organization_id: org.id }) });
      if (profileError) throw profileError;
      return { id: data.user.id, email };
    }
    const owner = await account("platform_admin"), manager = await account("org_admin"), learner = await account("employee");
    const { data: employee, error: employeeError } = await service.from("employees").insert({ organization_id: org.id, facility_id: facility.id,
      profile_id: learner.id, first_name: "Discovery", last_name: "Learner", job_title: "Aide", status: "active" }).select("id").single();
    if (employeeError) throw employeeError;
    const { error: facilityAssignmentError } = await service.from("facility_assignments").insert({ profile_id: learner.id, facility_id: facility.id });
    if (facilityAssignmentError && facilityAssignmentError.code !== "23505") throw facilityAssignmentError;
    const { data: course, error: courseError } = await service.from("courses").insert({ organization_id: null, title: courseTitle, status: "draft" }).select("id").single();
    if (courseError) throw courseError;
    const { data: version, error: versionError } = await service.from("course_versions").insert({ course_id: course.id, organization_id: null,
      title: courseTitle, version_number: 1, status: "draft", content_standard: "legacy" }).select("id").single();
    if (versionError) throw versionError;
    const { error: blockError } = await service.from("course_blocks").insert({ course_version_id: version.id, organization_id: null,
      block_type: "text", sort_order: 0, title: "Communication practice", body: { content: "Original disposable communication practice for this browser journey." } });
    if (blockError) throw blockError;

    await signInAs(page, owner.email, password, "/admin");
    const session = await verifyNewAdministrator(page);
    const publisher = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error: sessionError } = await publisher.auth.setSession(session);
    if (sessionError) throw sessionError;
    const { error: publishError } = await publisher.rpc("publish_course_version", { p_course_version_id: version.id });
    if (publishError) throw publishError;
    const { error: activateError } = await publisher.from("courses").update({ status: "published" }).eq("id", course.id);
    if (activateError) throw activateError;

    await test.step("owner publishes a reviewed elective collection and an original refresher", async () => {
      await page.goto("/admin/organizations");
      await page.getByText("Training library collections and optional refreshers", { exact: true }).click();
      await page.getByLabel("Collection title", { exact: true }).fill(collectionTitle);
      await page.getByLabel("Description", { exact: true }).fill("Optional communication learning selected for the practice library.");
      await page.getByLabel("Interest tags (comma separated)", { exact: true }).fill(`Communication-${suffix}`);
      await page.getByRole("group", { name: "Published system courses", exact: true }).getByRole("checkbox", { name: courseTitle, exact: true }).check();
      await page.getByRole("checkbox", { name: "Published in the learner library", exact: true }).check();
      await page.getByRole("button", { name: "Save collection", exact: true }).click();
      await expect(page.getByText("Collection saved", { exact: true })).toBeVisible();
      await page.getByLabel("Refresher title", { exact: true }).fill(lessonTitle);
      await page.getByLabel("Lesson and reflection activity", { exact: true }).fill("Pause and invite your colleague to explain the next step in their own words. Think of a routine instruction and rewrite it simply, then ask an open question that checks shared understanding.");
      await page.getByLabel("Optional practice question", { exact: true }).fill("Which response best checks shared understanding?");
      await page.getByRole("textbox", { name: "Answer 1", exact: true }).fill("Ask an open question");
      await page.getByRole("textbox", { name: "Answer 2", exact: true }).fill("Assume understanding");
      await page.getByLabel("Explain the answer", { exact: true }).fill("An open question helps the listener describe the next step so you can clarify the explanation.");
      await page.getByRole("checkbox", { name: "Reviewed and ready to publish", exact: true }).check();
      await page.getByRole("button", { name: "Save refresher", exact: true }).click();
      await expect(page.getByText("Refresher saved", { exact: true })).toBeVisible();
      // The wrapping label also contains every option's text; use the select's
      // accessible role/name so an exact label-text match cannot miss it.
      await page.getByRole("combobox", { name: "Course", exact: true }).selectOption(course.id);
      await page.getByLabel("Documented language", { exact: true }).fill("English");
      await page.getByRole("button", { name: "Save discovery information", exact: true }).click();
      await expect(page.getByText("Course discovery information saved", { exact: true })).toBeVisible();
    });

    const adminContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
    const learnerContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
    const admin = await adminContext.newPage(), student = await learnerContext.newPage();
    try {
      await test.step("facility administrator controls refresher frequency", async () => {
        await signInAs(admin, manager.email, password, "/app/train");
        await verifyNewAdministrator(admin);
        await admin.getByRole("tab", { name: "Facility Settings", exact: true }).click();
        await admin.getByRole("checkbox", { name: "Offer optional refreshers", exact: true }).check();
        await admin.getByLabel("Repeat a topic after (days)", { exact: true }).fill("14");
        await admin.getByRole("button", { name: "Save refresher settings", exact: true }).click();
        await expect(admin.getByText("Refresher settings saved", { exact: true })).toBeVisible();
      });
      await test.step("learner saves electives and discovers an interest collection without an assignment", async () => {
        await signInAs(student, learner.email, password, "/me/courses");
        await student.goto("/me/courses?view=library");
        await expect(student.getByRole("heading", { name: "Course Library", level: 1, exact: true })).toBeVisible();
        await student.getByRole("checkbox", { name: `Communication-${suffix}`, exact: true }).check();
        await student.getByRole("button", { name: `${collectionTitle} · Suggested`, exact: true }).click();
        const row = student.getByText(courseTitle, { exact: true }).locator("..").locator("..");
        await expect(row).toContainText("Language: English");
        await row.getByRole("button", { name: "Save for later", exact: true }).click();
        await expect(row.getByRole("button", { name: "Saved · Remove", exact: true })).toBeVisible();
        await student.reload();
        await student.getByRole("checkbox", { name: /Saved for later/ }).check();
        await expect(student.getByText(courseTitle, { exact: true })).toBeVisible();
        await expect(student.getByRole("checkbox", { name: `Communication-${suffix}`, exact: true })).toBeChecked();
        await expect(student.getByText("Choosing an interest or saving a course does not create an assignment or deadline.", { exact: false })).toBeVisible();
      });
      await test.step("optional practice explains the response and obeys facility cadence", async () => {
        await student.goto("/me/courses");
        const card = student.getByText(lessonTitle, { exact: true }).locator("..").locator("..");
        await card.getByRole("button", { name: "Open refresher", exact: true }).click();
        const dialog = student.getByRole("dialog", { name: lessonTitle, exact: true });
        await dialog.getByRole("radio", { name: "Assume understanding", exact: true }).check();
        await dialog.getByRole("button", { name: "Check answer", exact: true }).click();
        await expect(dialog.getByRole("status")).toContainText("An open question helps the listener describe the next step");
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        await student.reload();
        await student.getByText("Your recent refresher practice", { exact: true }).click();
        await expect(student.getByText(`${lessonTitle} · Reviewed explanation`, { exact: false })).toBeVisible();
        await expect(student.getByText(lessonTitle, { exact: true })).toHaveCount(0);
        await expectNoHorizontalOverflow(student);
        await student.screenshot({ path: "test-results/training-optional-practice.png", fullPage: true });
      });
      await test.step("facility report records practice separately from completions and certificates", async () => {
        await admin.reload();
        const response = admin.getByRole("row").filter({ hasText: lessonTitle });
        await expect(response).toContainText("Discovery Learner");
        await expect(response).toContainText("Reviewed explanation");
        const download = admin.waitForEvent("download");
        await admin.getByRole("button", { name: "Export refresher practice", exact: true }).click();
        expect((await download).suggestedFilename()).toBe("optional-refresher-practice.csv");
        const { count: assignments, error: assignmentError } = await service.from("course_assignments").select("id", { count: "exact", head: true }).eq("employee_id", employee.id);
        if (assignmentError) throw assignmentError;
        const { count: certificates, error: certificateError } = await service.from("certificates").select("id", { count: "exact", head: true }).eq("employee_id", employee.id);
        if (certificateError) throw certificateError;
        expect(assignments).toBe(0);
        expect(certificates).toBe(0);
      });
    } finally { await adminContext.close(); await learnerContext.close(); }
  });
});
