import { PDFDocument } from "pdf-lib";
import AxeBuilder from "@axe-core/playwright";
import { readAuthEmail, setPasswordFromEmail } from "./helpers/mailbox";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, hasLiveSupabaseEnv, signInAs } from "./helpers/auth";
import { facilityToday } from "./helpers/facilityDay";
import { totpCode } from "./helpers/totp";

/** Only provisions the empty tenant, initial credentials and a publishable catalog item.
 * Every student, invitation, enrollment and completion below is created through the UI. */
async function provisionEmptyTrainingFacility(service: SupabaseClient, url: string, password: string) {
  const suffix = crypto.randomUUID();
  const { data: organization, error: organizationError } = await service.from("organizations")
    .insert({ name: `New training organization ${suffix}`, slug: `new-training-${suffix}`, is_demo: false })
    .select("id").single();
  if (organizationError) throw organizationError;
  const { error: entitlementError } = await service.rpc("configure_train_signup", {
    p_organization_id: organization.id, p_complimentary: true,
  });
  if (entitlementError) throw entitlementError;
  const { data: facilities, error: facilityError } = await service.from("facilities").insert([
    { organization_id: organization.id, name: "Aspen other facility", facility_type: "PCH" },
    { organization_id: organization.id, name: "Cedar training facility", facility_type: "PCH" },
  ]).select("id,name");
  if (facilityError) throw facilityError;
  const facility = facilities.find(row => row.name === "Cedar training facility")!;
  const otherFacility = facilities.find(row => row.name === "Aspen other facility")!;

  const email = `new-training-admin-${suffix}@test.local`;
  const { data: administrator, error: administratorError } = await service.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { role: "org_admin", organization_id: organization.id },
    user_metadata: { first_name: "New", last_name: "Administrator" },
  });
  if (administratorError) throw administratorError;
  const { error: profileError } = await service.rpc("admin_update_profile", {
    p_user_id: administrator.user!.id, p_role: "org_admin", p_is_active: true, p_organization_id: organization.id,
  });
  if (profileError) throw profileError;

  // Publication uses the normal privileged command, not a direct published-row write.
  const publisherEmail = `new-training-publisher-${suffix}@test.local`;
  const { data: publisher, error: publisherError } = await service.auth.admin.createUser({
    email: publisherEmail, password, email_confirm: true, app_metadata: { role: "platform_admin" },
  });
  if (publisherError) throw publisherError;
  const { error: publisherProfileError } = await service.rpc("admin_update_profile", {
    p_user_id: publisher.user!.id, p_role: "platform_admin", p_is_active: true,
  });
  if (publisherProfileError) throw publisherProfileError;
  const publisherClient = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: publisherSignInError } = await publisherClient.auth.signInWithPassword({ email: publisherEmail, password });
  if (publisherSignInError) throw publisherSignInError;
  const courseTitle = `New facility classroom orientation ${suffix}`;
  const { data: course, error: courseError } = await service.from("courses").insert({
    organization_id: organization.id, title: courseTitle, status: "draft",
  }).select("id").single();
  if (courseError) throw courseError;
  const { data: version, error: versionError } = await service.from("course_versions").insert({
    course_id: course.id, organization_id: organization.id, version_number: 1,
    title: courseTitle, status: "draft", content_standard: "legacy",
  }).select("id").single();
  if (versionError) throw versionError;
  const { error: blockError } = await service.from("course_blocks").insert({
    course_version_id: version.id, organization_id: organization.id, block_type: "text", sort_order: 0,
    title: "Classroom orientation", body: { content: "Instructor-led orientation fixture for a new facility." },
  });
  if (blockError) throw blockError;
  const { error: publicationError } = await publisherClient.rpc("publish_course_version", { p_course_version_id: version.id });
  if (publicationError) throw publicationError;
  const { error: activationError } = await publisherClient.from("courses").update({ status: "published" }).eq("id", course.id);
  if (activationError) throw activationError;

  const electiveTitle = `Optional learning ${suffix}`;
  const { data: elective, error: electiveError } = await service.from("courses").insert({ organization_id: organization.id, title: electiveTitle, status: "draft" }).select("id").single();
  if (electiveError) throw electiveError;
  const { data: electiveVersion, error: electiveVersionError } = await service.from("course_versions").insert({ course_id: elective.id, organization_id: organization.id, version_number: 1, title: electiveTitle, status: "draft", content_standard: "legacy" }).select("id").single();
  if (electiveVersionError) throw electiveVersionError;
  const { error: electiveBlockError } = await service.from("course_blocks").insert({ course_version_id: electiveVersion.id, organization_id: organization.id, block_type: "text", sort_order: 0, title: "Optional lesson", body: { content: "This is voluntary learning for the new employee." } });
  if (electiveBlockError) throw electiveBlockError;
  const { error: electivePublicationError } = await publisherClient.rpc("publish_course_version", { p_course_version_id: electiveVersion.id });
  if (electivePublicationError) throw electivePublicationError;
  const { error: electiveActivationError } = await publisherClient.from("courses").update({ status: "published" }).eq("id", elective.id);
  if (electiveActivationError) throw electiveActivationError;
  return { organizationId: organization.id, facility, otherFacility, email, courseTitle, electiveTitle, courseId: course.id, suffix };
}

test.describe("new training facility administrator", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase test credentials required");

  test("first login, authenticator enrollment, student invitation, course enrollment and reporting stay in training", async ({ page, browser, request }, testInfo) => {
    test.setTimeout(240_000);
    const url = process.env.SUPABASE_URL!;
    // Both data setup and the app must be disposable/local. Never run this journey against a customer tenant.
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(new URL(String(testInfo.project.use.baseURL)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = process.env.E2E_ACCOUNT_PASSWORD!;
    const fixture = await provisionEmptyTrainingFacility(service, url, password);
    page.setDefaultTimeout(15_000);
    const initialDetailRequests: string[] = [];
    page.on("request", req => { if (/\/rpc\/get_training_workspace|\/rest\/v1\/certificates/.test(req.url())) initialDetailRequests.push(req.url()); });

    await test.step("a brand-new real tenant enrolls its first authenticator through the UI", async () => {
      await signInAs(page, fixture.email, password, "/app/train");
      await expect(page.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
      await page.getByRole("link", { name: "Open account security" }).click();
      await expect(page.getByText("No verification method is enrolled for this account.")).toBeVisible();
      await page.getByRole("button", { name: "Add authenticator app", exact: true }).click();
      // This is the manual setup key displayed to the user, not a seeded factor or an MFA bypass.
      const setupKey = page.getByText("Manual setup key", { exact: true }).locator("..").locator("code");
      await expect(setupKey).toBeVisible();
      const secret = (await setupKey.innerText()).trim();
      await page.getByLabel("Authenticator code", { exact: true }).fill(totpCode(secret));
      await page.getByRole("button", { name: "Verify authenticator", exact: true }).click();
      await expect(page.getByText("This session is already verified. You may return to the enterprise control plane.")).toBeVisible();
      await page.getByRole("button", { name: "Continue to the page you were opening" }).click();
      await expect(page.getByRole("heading", { name: "CareMetric Train", exact: true })).toBeVisible();
      await expect(page.getByText("Get your facility started", { exact: true })).toBeVisible();
      await page.getByLabel("Training facility").selectOption(fixture.facility.id);
      await expect.poll(() => new URL(page.url()).searchParams.get("facilityId")).toBe(fixture.facility.id);
      await page.getByLabel("Training facility").selectOption(fixture.otherFacility.id);
      await expect.poll(() => new URL(page.url()).searchParams.get("facilityId")).toBe(fixture.otherFacility.id);
      await page.goBack();
      await expect(page.getByLabel("Training facility")).toHaveValue(fixture.facility.id);
      await expect.poll(() => new URL(page.url()).searchParams.get("facilityId")).toBe(fixture.facility.id);
      await page.goForward();
      await expect(page.getByLabel("Training facility")).toHaveValue(fixture.otherFacility.id);
      await expect.poll(() => new URL(page.url()).searchParams.get("facilityId")).toBe(fixture.otherFacility.id);
      await page.goBack();
      await expect(page.getByLabel("Training facility")).toHaveValue(fixture.facility.id);
      await page.reload();
      await expect(page.getByLabel("Training facility")).toHaveValue(fixture.facility.id);
      await expect.poll(() => new URL(page.url()).searchParams.get("facilityId")).toBe(fixture.facility.id);
      // A Train-only administrator must not be encouraged into licensed operational modules.
      await expect(page.locator('a[href^="/app/residents"], a[href^="/app/workforce"], a[href^="/app/incidents"], a[href^="/app/today"]')).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Personalized workflow guidance" })).toHaveCount(0);
      expect(initialDetailRequests, "dashboard should not download the evidence or certificate ledger").toEqual([]);
      await page.getByRole("tab", { name: "Staff", exact: true }).click();
      await expect(page.getByText("No students yet. Add one student or import your roster to begin.")).toBeVisible();
      await page.getByRole("tab", { name: "Certificates", exact: true }).click();
      await expect(page.getByText("No certificates match these filters. Certificates become available after eligible course completion.")).toBeVisible();
    });

    const studentEmail = `new-training-student-${fixture.suffix}@test.local`;
    let studentId = "";
    await test.step("Add student preserves the selected facility and sends a real local invitation", async () => {
      await page.getByRole("link", { name: "Add student", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add Employee", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox", { name: "Facility *", exact: true })).toHaveText(fixture.facility.name);
      await dialog.getByLabel("First Name *", { exact: true }).fill("Everly");
      await dialog.getByLabel("Last Name *", { exact: true }).fill("Newlearner");
      await dialog.getByLabel("Email", { exact: true }).fill(studentEmail);
      await dialog.getByLabel("Job Title", { exact: true }).fill("Direct care staff");
      await dialog.getByLabel("Hire Date", { exact: true }).fill(facilityToday());
      await expect(dialog.getByRole("checkbox", { name: /Send portal invite/ })).toBeChecked();
      await dialog.getByRole("button", { name: "Create & Send Invite", exact: true }).click();
      await expect(page.getByText("Employee created and portal invite sent", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(dialog).not.toBeVisible();

      const { data: student, error: studentError } = await service.from("employees")
        .select("id,facility_id,organization_id,profile_id").eq("email", studentEmail).single();
      if (studentError) throw studentError;
      expect(student).toMatchObject({ facility_id: fixture.facility.id, organization_id: fixture.organizationId });
      expect(student.profile_id, "the UI invitation links the student to a portal account").toBeTruthy();
      studentId = student.id;
      const { data: invitedProfile, error: invitedProfileError } = await service.from("profiles")
        .select("role,organization_id").eq("id", student.profile_id).single();
      if (invitedProfileError) throw invitedProfileError;
      expect(invitedProfile).toMatchObject({ role: "employee", organization_id: fixture.organizationId });
      await page.getByRole("link", { name: "Back to training", exact: true }).click();
      await expect(page.getByLabel("Training facility")).toHaveValue(fixture.facility.id);
    });

    await test.step("the same facility is retained when enrolling the new student", async () => {
      await page.getByRole("link", { name: "Assign courses / view progress", exact: true }).click();
      await page.getByRole("button", { name: "Assign Training", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Assign Training", exact: true });
      await expect(dialog.getByRole("combobox", { name: "Filter employees by facility", exact: true })).toHaveText(fixture.facility.name);
      await dialog.getByRole("combobox", { name: "Training item *", exact: true }).click();
      // Large catalogs must stay scrollable within the browser viewport.
      await expect(page.getByRole("listbox")).toBeInViewport({ ratio: 1 });
      await page.getByRole("option", { name: fixture.courseTitle, exact: true }).click();
      await dialog.getByRole("checkbox", { name: /Newlearner, Everly/ }).check();
      await expect(dialog.getByLabel("Completion required by *", { exact: true })).toBeEmpty();
      await dialog.getByRole("button", { name: "Assign to 1 Employee", exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(page.getByText("Enter a completion required-by date", { exact: true })).toBeVisible();
      await dialog.getByLabel("Completion required by *", { exact: true }).fill("2027-03-15");
      await dialog.getByRole("button", { name: "Assign to 1 Employee", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const row = page.getByRole("row").filter({ hasText: fixture.courseTitle });
      await expect(row).toContainText("Everly");
      await expect(row).toContainText("Assigned");
      await row.getByRole("button", { name: "Progress", exact: true }).click();
      const progress = page.getByRole("dialog", { name: "Training Progress", exact: true });
      await expect(progress.getByText("No progress recorded yet.")).toBeVisible();
      await progress.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("link", { name: "Back to training", exact: true }).click();
      await expect(page.getByLabel("Training facility")).toHaveValue(fixture.facility.id);
      await page.getByRole("tab", { name: "Reports", exact: true }).click();
      const report = page.getByRole("region", { name: "Enrollment, completion & certificates", exact: true });
      const reportRow = report.getByRole("row").filter({ hasText: fixture.courseTitle });
      await expect(reportRow).toContainText("Everly Newlearner");
      await expect(reportRow).toContainText(fixture.facility.name);
      await expect(reportRow).toContainText("0%");
      await expect(reportRow).toContainText("Not issued");
      await expect(report.getByText("0 completed / 1 non-canceled enrollments", { exact: false })).toBeVisible();
      await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    });

    await test.step("invited learner activates, explores electives, completes required learning and recovers on another device", async () => {
      const invitation = await readAuthEmail(request, studentEmail, "invite");
      const learnerContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      learnerContext.setDefaultTimeout(15_000);
      try {
        const learnerPage = await learnerContext.newPage();
        await setPasswordFromEmail(learnerPage, invitation.url, password);
        await signInAs(learnerPage, studentEmail, password, "/me/courses");
        await expect(learnerPage.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
        await expect(learnerPage.getByRole("region", { name: "Personalized workflow guidance" })).toHaveCount(0);
        await expect(learnerPage.getByText("Your next required course", { exact: true })).toBeInViewport();
        await expect(learnerPage.getByText(/Due .*2027/).first()).toBeVisible();
        await expectNoHorizontalOverflow(learnerPage);
        const accessibility = await new AxeBuilder({ page: learnerPage }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const blockingAccessibility = accessibility.violations.filter(v => v.impact === "critical" || v.impact === "serious");
        expect(blockingAccessibility, JSON.stringify(blockingAccessibility, null, 2)).toEqual([]);
        await expect(learnerPage.getByText("Login successful", { exact: true })).not.toBeVisible({ timeout: 10_000 });
        await learnerPage.screenshot({ path: `test-results/training-learner-next-${testInfo.project.name}.png`, fullPage: true });
        // Keyboard navigation reaches and activates the same real learner action.
        const start = learnerPage.getByRole("link", { name: "Start required course", exact: true });
        await start.focus(); await expect(start).toBeFocused(); await learnerPage.keyboard.press("Enter");
        // The overview repeats this text; target the actual reading content.
        await expect(learnerPage.locator("p.whitespace-pre-wrap").filter({ hasText: "Instructor-led orientation fixture for a new facility." })).toBeVisible();
        const complete = learnerPage.getByRole("button", { name: "Mark Training Complete", exact: true });
        await expect(complete).toBeDisabled();
        await expect(learnerPage.getByText(/Continue reviewing the lesson. Completion is available in/)).toBeVisible();
        // Honor the actual server pacing floor; do not backdate progress or bypass completion.
        await expect(complete).toBeEnabled({ timeout: 70_000 });
        await learnerPage.getByRole("button", { name: "Mark Training Complete", exact: true }).click();
        await expect(learnerPage.getByRole("heading", { name: "Rate this training", exact: true })).toBeVisible();
        await learnerPage.getByRole("button", { name: "Skip", exact: true }).click();
        await expect(learnerPage.getByRole("heading", { name: "My Certificates", exact: true })).toBeVisible();
        await expect(learnerPage.getByText(fixture.courseTitle, { exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(learnerPage);
        await learnerPage.goto("/me/courses?view=library");
        await expect(learnerPage.getByRole("heading", { name: "Course Library", exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(learnerPage);
        // The library includes the course just completed, so review is still discoverable.
        await learnerPage.getByLabel("Find a course").fill(fixture.courseTitle);
        await expect(learnerPage.getByText(fixture.courseTitle, { exact: true })).toBeVisible();
        await expect(learnerPage.getByRole("button", { name: "Review", exact: true })).toBeVisible();
        await learnerPage.getByLabel("Find a course").fill(fixture.electiveTitle);
        await learnerPage.getByRole("button", { name: "Start", exact: true }).click();
        await expect(learnerPage.locator("p.whitespace-pre-wrap").filter({ hasText: "This is voluntary learning for the new employee." })).toBeVisible();
        await learnerPage.goto("/me/courses");
        await expect(learnerPage.getByText("1 / 1 required courses completed", { exact: true })).toBeVisible();
        await learnerPage.getByRole("button", { name: "Optional", exact: true }).click();
        await expect(learnerPage.getByText(fixture.electiveTitle, { exact: true })).toBeVisible();
        await expect(learnerPage.getByText("You chose this course", { exact: true })).toBeVisible();
        await learnerPage.screenshot({ path: "test-results/training-learner-mobile.png", fullPage: true });
      } finally { await learnerContext.close(); }
      const secondDevice = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
      secondDevice.setDefaultTimeout(15_000);
      try {
        const recoveryPage = await secondDevice.newPage();
        // A used invite is rejected, with an explicit working recovery route.
        await recoveryPage.goto(invitation.url);
        await expect(recoveryPage.getByRole("button", { name: "Request a new link", exact: true })).toBeVisible();
        await recoveryPage.getByRole("button", { name: "Request a new link", exact: true }).click();
        await recoveryPage.getByLabel("Email address", { exact: true }).fill(studentEmail);
        await recoveryPage.getByRole("button", { name: "Send reset link", exact: true }).click();
        await expect(recoveryPage.getByText("Email sent", { exact: true })).toBeVisible();
        const recovery = await readAuthEmail(request, studentEmail, "recovery");
        await setPasswordFromEmail(recoveryPage, recovery.url, `${password}R`);
        await signInAs(recoveryPage, studentEmail, `${password}R`, "/me/courses");
        await expect(recoveryPage.getByText("1 / 1 required courses completed", { exact: true })).toBeVisible();
      } finally { await secondDevice.close(); }
    });

    await test.step("administrator sees the learner completion, certificate and full export", async () => {
      await page.getByRole("tab", { name: "Reports", exact: true }).click();
      const report = page.getByRole("region", { name: "Enrollment, completion & certificates", exact: true });
      // Reopening the same report must refresh the cached pre-completion totals before a
      // changed filter creates a new query key and could hide a stale-return regression.
      await expect(report.getByText("1 completed / 2 non-canceled enrollments", { exact: false })).toBeVisible();
      await report.getByRole("combobox", { name: "Enrollment status", exact: true }).selectOption("completed");
      const reportRow = report.getByRole("row").filter({ hasText: fixture.courseTitle });
      await expect(reportRow).toContainText("100%");
      await expect(reportRow.getByRole("button", { name: "Open certificate", exact: true })).toBeVisible();
      await expect(report.getByText("1 completed / 1 non-canceled enrollments", { exact: false })).toBeVisible();
      const csvDownload = page.waitForEvent("download");
      await report.getByRole("button", { name: "Export all matching enrollments (CSV)", exact: true }).click();
      const csv = await csvDownload;
      expect(csv.suggestedFilename()).toMatch(/^training-enrollments-.*\.csv$/);
      const csvText = await readFile((await csv.path())!, "utf8");
      expect(csvText).toContain("Everly Newlearner");
      expect(csvText).toContain(fixture.facility.name);
      expect(csvText).toContain(fixture.courseTitle);
      expect(csvText).not.toContain("Aspen other facility");
      // Capture the document at the actual native-print boundary. page.pdf() alone would
      // exercise only the visible screen, not the full-report export/portal used by this button.
      await page.evaluate(() => {
        const nativePrint = window.print;
        window.print = () => {
          const printable = document.querySelector("[data-training-report-print]");
          const base = document.createElement("base");
          base.href = document.baseURI;
          (window as Window & { trainingPrintSnapshot?: { text: string; rows: string[][]; html: string; head: string } }).trainingPrintSnapshot = {
            text: printable?.textContent ?? "",
            rows: Array.from(printable?.querySelectorAll("tbody tr") ?? []).map(row =>
              Array.from(row.querySelectorAll("td")).map(cell => cell.textContent ?? "")),
            html: printable?.outerHTML ?? "",
            // Preserve the actual document's styling and local asset URLs without scripts
            // that could boot the application inside the static print-evidence page.
            head: base.outerHTML + Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))
              .map(element => element.outerHTML).join(""),
          };
          window.print = nativePrint;
        };
      });
      await report.getByRole("button", { name: "Print all matching enrollments", exact: true }).click();
      await expect.poll(() => page.evaluate(() =>
        (window as Window & { trainingPrintSnapshot?: { rows: string[][] } }).trainingPrintSnapshot?.rows.length,
      )).toBe(1);
      const printed = await page.evaluate(() =>
        (window as Window & { trainingPrintSnapshot?: { text: string; rows: string[][]; html: string; head: string } }).trainingPrintSnapshot!,
      );
      expect(printed.text).toContain("1 enrollments; 1 distinct students; 1 completed / 1 non-canceled; 1 issued certificates");
      expect(printed.rows[0]).toEqual(expect.arrayContaining(["Everly Newlearner", fixture.facility.name]));
      const printedRow = printed.rows[0].join(" ");
      expect(printedRow).toContain(fixture.courseTitle);
      expect(printedRow).toContain("Required");
      expect(printedRow).toContain("100%");
      expect(printedRow).toContain("Completed:");
      expect(printed.text).not.toContain("Aspen other facility");

      await report.screenshot({ path: "test-results/new-training-facility-report.png" });
      const printEvidence = await page.context().newPage();
      try {
        await printEvidence.emulateMedia({ media: "print" });
        await printEvidence.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">${printed.head}</head><body>${printed.html}</body></html>`, { waitUntil: "load" });
        await printEvidence.evaluate(async () => { await document.fonts.ready; });
        await expect(printEvidence.locator("[data-training-report-print]")).toBeVisible();
        await expect(printEvidence.getByRole("row")).toHaveCount(printed.rows.length + 1);
        if (testInfo.project.name === "chromium") await printEvidence.pdf({ path: "test-results/new-training-facility-report.pdf", format: "Letter", preferCSSPageSize: true, printBackground: true });
      } finally {
        await printEvidence.close();
      }
      // A profile correction must not silently restate the award during its first PDF render.
      await page.getByRole("tab", { name: "Staff", exact: true }).click();
      await page.getByRole("link", { name: "Staff details", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const editEmployee = page.getByRole("dialog", { name: "Edit Employee", exact: true });
      await editEmployee.getByLabel("First Name *", { exact: true }).fill("Updated");
      await editEmployee.getByLabel("Last Name *", { exact: true }).fill("Profile");
      await editEmployee.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(editEmployee).not.toBeVisible();
      await expect(page.getByRole("heading", { name: "Updated Profile", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Back to training", exact: true }).click();
      await page.getByRole("tab", { name: "Certificates", exact: true }).click();
      await page.getByLabel("Training student").selectOption(studentId);
      await expect(page.getByRole("checkbox", { name: new RegExp(fixture.courseTitle) })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open PDF / print", exact: true })).toBeVisible();
      await page.getByRole("checkbox", { name: new RegExp(fixture.courseTitle) }).check();
      const [packet] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.waitForResponse(response => response.url().endsWith("/functions/v1/generate-certificate-pdf"), { timeout: 30_000 }).then(async response => {
          const result = await response.json() as { success?: boolean; error?: string };
          expect(response.status(), result.error || "Certificate generation should succeed").toBe(200);
          expect(result.success).toBe(true);
        }),
        page.getByRole("button", { name: "Download selected for printing (PDF)", exact: true }).click(),
      ]);
      expect(packet.suggestedFilename()).toMatch(/\.pdf$/);
      await packet.saveAs(`test-results/training-certificate-packet-${testInfo.project.name}.pdf`);
      const packetPdf = await PDFDocument.load(await readFile((await packet.path())!));
      expect(packetPdf.getPageCount()).toBe(1);
      const { data: generatedCertificate, error: certificateError } = await service.from("certificates")
        .select("pdf_status,course_title_snapshot,learner_name_snapshot,slug").eq("employee_id", studentId).eq("course_id", fixture.courseId).single();
      if (certificateError) throw certificateError;
      expect(generatedCertificate).toMatchObject({ pdf_status: "ready", course_title_snapshot: fixture.courseTitle, learner_name_snapshot: "Everly Newlearner" });
      const { data: verification, error: verificationError } = await service.rpc("verify_certificate", { p_slug: generatedCertificate.slug });
      if (verificationError) throw verificationError;
      expect(verification[0]).toMatchObject({ employee_name: "Everly Newlearner", course_title: fixture.courseTitle });
      await expect(page.getByText("No certificates match these filters. Certificates become available after eligible course completion.")).toHaveCount(0);
      await page.goto("/app/residents");
      await expect.poll(() => new URL(page.url()).pathname).toBe("/app/train");
    });
  });

  test("the owner creates a Train-only facility, invites its administrator and opens its reporting context", async ({ page, browser, request }, testInfo) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    // The standalone product intentionally omits the owner's general organization-management console.
    test.skip(process.env.PLAYWRIGHT_TRAIN_BUILD === "true" || testInfo.project.name === "mobile-safari", "owner provisioning is in the universal super-admin console");
    const url = process.env.SUPABASE_URL!;
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(new URL(String(testInfo.project.use.baseURL)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = process.env.E2E_ACCOUNT_PASSWORD!;
    const suffix = crypto.randomUUID();
    const ownerEmail = `training-owner-${suffix}@test.local`;
    const { data: owner, error: ownerError } = await service.auth.admin.createUser({
      email: ownerEmail, password, email_confirm: true, app_metadata: { role: "platform_admin" },
    });
    if (ownerError) throw ownerError;
    const { error: profileError } = await service.rpc("admin_update_profile", {
      p_user_id: owner.user!.id, p_role: "platform_admin", p_is_active: true,
    });
    if (profileError) throw profileError;

    await signInAs(page, ownerEmail, password, "/admin");
    await expect(page.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
    await page.getByRole("link", { name: "Open account security" }).click();
    await page.getByRole("button", { name: "Add authenticator app", exact: true }).click();
    const setupKey = page.getByText("Manual setup key", { exact: true }).locator("..").locator("code");
    await expect(setupKey).toBeVisible();
    await page.getByLabel("Authenticator code", { exact: true }).fill(totpCode((await setupKey.innerText()).trim()));
    await page.getByRole("button", { name: "Verify authenticator", exact: true }).click();
    await expect(page.getByText("This session is already verified. You may return to the enterprise control plane.")).toBeVisible();
    await page.getByRole("button", { name: "Continue to the page you were opening" }).click();

    await page.goto("/admin/organizations");
    await page.getByRole("button", { name: "Create complimentary training facility", exact: true }).click();
    const organizationName = `Owner-created Train organization ${suffix}`;
    const facilityName = `Owner-created ALF ${suffix}`;
    await page.getByLabel("Organization name", { exact: true }).fill(organizationName);
    await page.getByLabel("Facility name", { exact: true }).fill(facilityName);
    await page.getByRole("combobox", { name: "License type", exact: true }).selectOption({ label: "Pennsylvania Assisted Living Facility (ALF)" });
    const administratorEmail = `owner-invited-training-admin-${suffix}@test.local`;
    await page.getByLabel("Administrator first name", { exact: true }).fill("Facility");
    await page.getByLabel("Administrator last name", { exact: true }).fill("Administrator");
    await page.getByLabel("Administrator email", { exact: true }).fill(administratorEmail);
    // Exercise the recoverable boundary after provisioning but before sending the first email.
    await page.route("**/functions/v1/invite-user", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Disposable invitation outage" }) }), { times: 1 });
    const failedInvitation = page.waitForResponse(response => response.url().endsWith("/functions/v1/invite-user") && response.status() === 503);
    await page.getByRole("button", { name: "Create free Train access", exact: true }).click();
    await failedInvitation;
    await expect(page.getByText("Training-only facility created. Administrator invitation needs attention.", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Retry administrator invitation", exact: true }).click();
    await expect(page.getByText("Training-only facility created. Administrator invitation sent.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const { data: organization, error: organizationError } = await service.from("organizations")
      .select("id,is_demo").eq("name", organizationName).single();
    if (organizationError) throw organizationError;
    expect(organization.is_demo).toBe(false);
    const { data: facility, error: facilityError } = await service.from("facilities")
      .select("id,name,facility_type").eq("organization_id", organization.id).single();
    if (facilityError) throw facilityError;
    expect(facility).toMatchObject({ name: facilityName, facility_type: "ALR" });

    await page.reload();
    await expect(page.getByText("Training-only facility created. Administrator invitation sent.", { exact: true })).toBeVisible();
    // Recovery receipt must reuse the existing facility rather than make another tenant.
    const { count } = await service.from("organizations").select("id", { count: "exact", head: true }).eq("name", organizationName);
    expect(count).toBe(1);
    const administratorInvite = await readAuthEmail(request, administratorEmail, "invite");
    const adminContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
    adminContext.setDefaultTimeout(15_000);
    try {
      const adminPage = await adminContext.newPage();
      await setPasswordFromEmail(adminPage, administratorInvite.url, password);
      await signInAs(adminPage, administratorEmail, password, "/app/train");
      await expect(adminPage.getByRole("heading", { name: "Multi-factor verification required" })).toBeVisible();
    } finally { await adminContext.close(); }
    const { data: invited, error: invitedError } = await service.from("profiles")
      .select("role,organization_id").eq("email", administratorEmail).single();
    if (invitedError) throw invitedError;
    expect(invited).toMatchObject({ role: "org_admin", organization_id: organization.id });

    await page.goto(`/admin/training-reports?organizationId=${organization.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Facility training reports", exact: true })).toBeVisible();
    await expect(page.getByLabel("Report organization", { exact: true })).toHaveValue(organization.id);
    const report = page.getByRole("region", { name: "Enrollment, completion & certificates", exact: true });
    await report.getByRole("combobox", { name: "Report facility", exact: true }).selectOption(facility.id);
    await expect(report.getByText("No enrollments match these filters. Assign a course to a student to begin tracking completion.", { exact: true })).toBeVisible();
    await expect(report.getByText("0 enrollments", { exact: true })).toBeVisible();
    await expect(report.getByRole("row")).toHaveCount(1); // Column headings, no other customer's learners.
    const csvDownload = page.waitForEvent("download");
    await report.getByRole("button", { name: "Export all matching enrollments (CSV)", exact: true }).click();
    const csv = await csvDownload;
    const csvText = await readFile((await csv.path())!, "utf8");
    expect(csvText).toContain(organizationName);
    expect(csvText).toContain(facilityName);
    expect(csvText).toContain('"Enrollments","0","Students","0"');
  });
});
