import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { hasLiveSupabaseEnv, signInAs } from "./helpers/auth";
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

  return { organizationId: organization.id, facility, otherFacility, email, courseTitle, courseId: course.id, suffix };
}

test.describe("new training facility administrator", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase test credentials required");

  test("first login, authenticator enrollment, student invitation, course enrollment and reporting stay in training", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const url = process.env.SUPABASE_URL!;
    // Both data setup and the app must be disposable/local. Never run this journey against a customer tenant.
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(new URL(String(testInfo.project.use.baseURL)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = process.env.E2E_ACCOUNT_PASSWORD!;
    const fixture = await provisionEmptyTrainingFacility(service, url, password);
    page.setDefaultTimeout(15_000);

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
      await expect(page.getByRole("heading", { name: "Get your facility started", exact: true })).toBeVisible();
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
      await page.getByRole("tab", { name: "Students", exact: true }).click();
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
      await page.getByRole("tab", { name: "Enrollment & completion", exact: true }).click();
      const report = page.getByRole("region", { name: "Enrollment, completion & certificates", exact: true });
      const reportRow = report.getByRole("row").filter({ hasText: fixture.courseTitle });
      await expect(reportRow).toContainText("Everly Newlearner");
      await expect(reportRow).toContainText(fixture.facility.name);
      await expect(reportRow).toContainText("0%");
      await expect(reportRow).toContainText("Not issued");
      await expect(report.getByText("0 completed / 1 non-canceled enrollments", { exact: false })).toBeVisible();
    });

    await test.step("record a classroom completion, see its certificate and export the facility report", async () => {
      await page.getByRole("link", { name: "Assign courses / view progress", exact: true }).click();
      const assignmentRow = page.getByRole("row").filter({ hasText: fixture.courseTitle });
      await assignmentRow.getByRole("button", { name: "Mark Complete", exact: true }).click();
      await expect(page.getByText("Marked complete", { exact: true })).toBeVisible();
      await expect(assignmentRow).toContainText("Completed");
      await page.getByRole("link", { name: "Back to training", exact: true }).click();
      await page.getByRole("tab", { name: "Enrollment & completion", exact: true }).click();
      const report = page.getByRole("region", { name: "Enrollment, completion & certificates", exact: true });
      // Reopening the same report must refresh the cached pre-completion totals before a
      // changed filter creates a new query key and could hide a stale-return regression.
      await expect(report.getByText("1 completed / 1 non-canceled enrollments", { exact: false })).toBeVisible();
      await report.getByRole("combobox", { name: "Enrollment status", exact: true }).selectOption("completed");
      const reportRow = report.getByRole("row").filter({ hasText: fixture.courseTitle });
      await expect(reportRow).toContainText("100%");
      await expect(reportRow.getByRole("button", { name: /^Open certificate / })).toBeVisible();
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
      expect(printed.rows[0]).toEqual(expect.arrayContaining(["Everly Newlearner", fixture.facility.name, fixture.courseTitle, "100"]));
      expect(printed.text).not.toContain("Aspen other facility");
      await page.getByText("Marked complete", { exact: true }).waitFor({ state: "hidden", timeout: 10_000 });
      await report.screenshot({ path: "test-results/new-training-facility-report.png" });
      const printEvidence = await page.context().newPage();
      try {
        await printEvidence.emulateMedia({ media: "print" });
        await printEvidence.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">${printed.head}</head><body>${printed.html}</body></html>`, { waitUntil: "load" });
        await printEvidence.evaluate(async () => { await document.fonts.ready; });
        await expect(printEvidence.locator("[data-training-report-print]")).toBeVisible();
        await expect(printEvidence.getByRole("row")).toHaveCount(printed.rows.length + 1);
        await printEvidence.pdf({ path: "test-results/new-training-facility-report.pdf", format: "Letter", preferCSSPageSize: true, printBackground: true });
      } finally {
        await printEvidence.close();
      }
      await page.getByRole("tab", { name: "Certificates", exact: true }).click();
      await page.getByLabel("Training student").selectOption(studentId);
      await expect(page.getByRole("checkbox", { name: new RegExp(fixture.courseTitle) })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open PDF / print", exact: true })).toBeVisible();
      await expect(page.getByText("No certificates match these filters. Certificates become available after eligible course completion.")).toHaveCount(0);
      await page.goto("/app/residents");
      await expect.poll(() => new URL(page.url()).pathname).toBe("/app/train");
    });
  });

  test("the owner creates a Train-only facility, invites its administrator and opens its reporting context", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    // The standalone product intentionally omits the owner's general organization-management console.
    test.skip(process.env.PLAYWRIGHT_TRAIN_BUILD === "true", "owner provisioning is in the universal super-admin console");
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
    await page.getByRole("button", { name: "Create free Train access", exact: true }).click();
    await expect(page.getByText("Training facility created. Next, invite its administrator.", { exact: true })).toBeVisible();
    const { data: organization, error: organizationError } = await service.from("organizations")
      .select("id,is_demo").eq("name", organizationName).single();
    if (organizationError) throw organizationError;
    expect(organization.is_demo).toBe(false);
    const { data: facility, error: facilityError } = await service.from("facilities")
      .select("id,name,facility_type").eq("organization_id", organization.id).single();
    if (facilityError) throw facilityError;
    expect(facility).toMatchObject({ name: facilityName, facility_type: "ALR" });

    await page.getByRole("link", { name: "Invite facility administrator", exact: true }).click();
    const invitation = page.getByRole("dialog", { name: "Invite facility administrator", exact: true });
    await expect(invitation).toBeVisible();
    const role = invitation.getByRole("combobox", { name: "Role *", exact: true });
    await expect(role).toHaveText("Org Admin");
    await expect(role).toBeDisabled();
    const selectedOrganization = invitation.getByRole("combobox", { name: "Organization *", exact: true });
    await expect(selectedOrganization).toHaveText(organizationName);
    await expect(selectedOrganization).toBeDisabled();
    await expect(invitation.getByRole("switch", { name: /Send an email invite/ })).toBeChecked();
    await expect(invitation.getByRole("switch", { name: /Send an email invite/ })).toBeDisabled();
    await expect(invitation.getByText("Platform Admin", { exact: true })).toHaveCount(0);
    const administratorEmail = `owner-invited-training-admin-${suffix}@test.local`;
    await invitation.getByLabel("First Name *", { exact: true }).fill("Facility");
    await invitation.getByLabel("Last Name *", { exact: true }).fill("Administrator");
    await invitation.getByLabel("Email *", { exact: true }).fill(administratorEmail);
    await invitation.getByRole("button", { name: "Send Invite", exact: true }).click();
    await expect(page.getByText("Invite sent", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(invitation).not.toBeVisible();
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
