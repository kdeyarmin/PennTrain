import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
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
const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL ?? `${(supabaseUrl ?? "").replace(/\/$/, "")}/functions/v1`;
const password = process.env.E2E_ACCOUNT_PASSWORD ?? "";
const guestEmail = "phase1-guest@test.local";
let verificationSlug: string;
let residentPortalToken: string;
let incidentId: string;
let trainingClassId: string;
let employeeRecordId: string;
let evidenceGuestToken: string;
let orgAdminMfaFactorId: string;
let orgAdminMfaSecret: string;

let admin: SupabaseClient;
let organizationId: string;
let facilityId: string;
const accounts = new Map<TestRole, TestAccount>();

function totpCode(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Authenticator secret is not valid base32");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function verifyOrgAdminClientMfa(client: SupabaseClient) {
  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId: orgAdminMfaFactorId,
    code: totpCode(orgAdminMfaSecret),
  });
  if (error) throw error;
}

async function verifyOrgAdminBrowserMfa(page: Page) {
  await page.goto("/account/security");
  const code = page.getByLabel("Authenticator code");
  await expect(code).toBeVisible();
  await code.fill(totpCode(orgAdminMfaSecret));
  await page.getByRole("button", { name: "Verify authenticator" }).click();
  await expect(page.getByText(/session is already verified/i)).toBeVisible();
}

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

  const { error: profileError } = await admin.rpc("admin_update_profile", {
    p_user_id: data.user.id,
    p_role: role,
    p_is_active: true,
    ...(role === "platform_admin"
      ? {}
      : { p_organization_id: organizationId }),
  });
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

    // The demo account email is part of the built application configuration,
    // so retries must reuse it instead of generating a new address.
    const { data: existingUsers, error: listUsersError } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listUsersError) throw listUsersError;
    const existingGuest = existingUsers.users.find(
      (user) => user.email === guestEmail,
    );
    let guestId = existingGuest?.id;
    if (guestId) {
      const { error: updateGuestError } =
        await admin.auth.admin.updateUserById(guestId, {
          password,
          email_confirm: true,
          app_metadata: { role: "auditor", organization_id: organizationId },
          user_metadata: { first_name: "Guest", last_name: "Auditor" },
        });
      if (updateGuestError) throw updateGuestError;
    } else {
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
      guestId = guest.user.id;
    }
    const { error: guestProfileError } = await admin.rpc(
      "admin_update_profile",
      {
        p_user_id: guestId,
        p_role: "auditor",
        p_organization_id: organizationId,
        p_is_active: true,
      },
    );
    if (guestProfileError) throw guestProfileError;
    for (const role of ["org_admin", "facility_manager", "trainer"] as const) {
      const account = accounts.get(role)!;
      const { error } = await admin.from("facility_assignments").insert({
        profile_id: account.id,
        facility_id: facilityId,
      });
      if (error) throw error;
    }

    const employee = accounts.get("employee")!;
    const { data: employeeRecord, error: employeeError } = await admin
      .from("employees")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        profile_id: employee.id,
        first_name: "Phase",
        last_name: "Employee",
        email: employee.email,
        job_title: "Direct Care Worker",
        status: "active",
      })
      .select("id")
      .single();
    if (employeeError) throw employeeError;
    employeeRecordId = employeeRecord.id;

    const orgAdmin = accounts.get("org_admin")!;
    const orgAdminAuthClient = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: orgAdminSignIn, error: orgAdminSignInError } =
      await orgAdminAuthClient.auth.signInWithPassword({
        email: orgAdmin.email,
        password,
      });
    if (orgAdminSignInError || !orgAdminSignIn.session) {
      throw (
        orgAdminSignInError ??
        new Error("Org admin sign-in returned no session")
      );
    }
    const { data: mfaEnrollment, error: mfaEnrollmentError } =
      await orgAdminAuthClient.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `E2E administrator ${suffix}`,
      });
    if (mfaEnrollmentError) throw mfaEnrollmentError;
    orgAdminMfaFactorId = mfaEnrollment.id;
    orgAdminMfaSecret = mfaEnrollment.totp.secret;
    await verifyOrgAdminClientMfa(orgAdminAuthClient);
    const { data: orgAdminSession, error: orgAdminSessionError } =
      await orgAdminAuthClient.auth.getSession();
    if (orgAdminSessionError || !orgAdminSession.session) {
      throw orgAdminSessionError ?? new Error("Org admin MFA returned no session");
    }
    const orgAdminClient = createClient(supabaseUrl!, anonKey!, {
      global: {
        headers: {
          Authorization: "Bearer " + orgAdminSession.session.access_token,
        },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: resident, error: residentError } = await orgAdminClient
      .from("residents")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        first_name: "Portal",
        last_name: "Resident",
        room: "10",
        admission_date: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (residentError) throw residentError;

    const { data: incident, error: incidentError } = await orgAdminClient.rpc(
      "create_incident_atomic",
      {
        p_organization_id: organizationId,
        p_facility_id: facilityId,
        p_incident_type: "significant_injury",
        p_occurred_at: new Date().toISOString(),
        p_resident_id: resident.id,
        p_resident_identifier_snapshot: null,
        p_location_detail: "Resident room 10",
        p_narrative:
          "E2E reportable incident used to verify official state-form generation.",
        p_severity: "major",
        p_staff_involved: [],
        p_notifications: [],
        p_idempotency_key: `e2e-state-form-${suffix}`,
      },
    );
    if (incidentError) throw incidentError;
    incidentId = incident.id;
    const { data: portalGrant, error: portalGrantError } =
      await orgAdminClient
        .rpc("create_resident_portal_grant", {
          p_resident_id: resident.id,
          p_designated_person_name: "Portal Representative",
          p_relationship_label: "Designated person",
          p_contact_email: "portal-representative@test.local",
          p_permissions: ["schedule", "messages"],
          p_expires_at: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        })
        .single();
    if (portalGrantError) throw portalGrantError;
    residentPortalToken = portalGrant.access_token;

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

    // Publishing a version makes it the immutable current version; activating
    // the course is a separate catalog decision. Mirror that production
    // workflow so the assignment-integrity trigger never relies on a draft
    // course being assignable.
    const { error: activateCourseError } = await platformClient
      .from("courses")
      .update({ status: "published" })
      .eq("id", course.id);
    if (activateCourseError) throw activateCourseError;

    const { data: assignment, error: assignmentError } = await platformClient
      .from("course_assignments")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        employee_id: employeeRecord.id,
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

    const { data: trainingType, error: trainingTypeError } = await orgAdminClient.from("training_types").insert({
      organization_id: organizationId,
      name: "E2E QR attendance",
      code: `E2E-QR-${suffix}`,
      category: "orientation",
    }).select("id").single();
    if (trainingTypeError) throw trainingTypeError;
    const trainer = accounts.get("trainer")!;
    const { data: trainingClass, error: trainingClassError } = await orgAdminClient.from("training_classes").insert({
      organization_id: organizationId,
      facility_id: facilityId,
      training_type_id: trainingType.id,
      trainer_profile_id: trainer.id,
      class_name: "E2E QR check-in class",
      class_date: new Date().toISOString().slice(0, 10),
      status: "scheduled",
    }).select("id").single();
    if (trainingClassError) throw trainingClassError;
    trainingClassId = trainingClass.id;
    const { error: attendeeError } = await orgAdminClient.from("training_class_attendees").insert({
      class_id: trainingClassId,
      employee_id: employeeRecordId,
    });
    if (attendeeError) throw attendeeError;

    // Build a checksummed immutable binder fixture through the production
    // evidence lifecycle. The public journey below then exercises terms,
    // token scoping, and the guest artifact list end to end.
    const checksum = "a".repeat(64);
    const { data: binderJob, error: binderJobError } = await admin.from("binder_export_jobs").insert({
      organization_id: organizationId,
      requested_by: orgAdmin.id,
      facility_ids: [facilityId],
      status: "succeeded",
      completed_at: new Date().toISOString(),
      storage_bucket: "compliance-binders",
      storage_path: `${organizationId}/e2e-binder.pdf`,
      content_sha256: checksum,
      byte_size: 1024,
    }).select("id").single();
    if (binderJobError) throw binderJobError;
    const { data: collection, error: collectionError } = await orgAdminClient.rpc("create_evidence_collection", {
      p_facility_id: facilityId,
      p_name: "E2E Survey Evidence",
      p_purpose: "Verify secure guest evidence access",
      p_terms_version: "v1",
    });
    if (collectionError) throw collectionError;
    const { data: artifact, error: artifactError } = await orgAdminClient.rpc("add_binder_export_to_evidence_collection", {
      p_collection_id: collection.id,
      p_binder_job_id: binderJob.id,
      p_display_name: "E2E Compliance Binder",
    });
    if (artifactError) throw artifactError;
    const { error: publishCollectionError } = await orgAdminClient.rpc("set_evidence_collection_status", {
      p_collection_id: collection.id,
      p_status: "published",
    });
    if (publishCollectionError) throw publishCollectionError;
    const { data: grant, error: grantError } = await orgAdminClient.rpc("issue_evidence_guest_grant", {
      p_collection_id: collection.id,
      p_guest_label: "E2E Surveyor",
      p_guest_email_hash: null as unknown as string,
      p_allowed_artifact_ids: [artifact.id],
      p_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      p_step_up: false,
    });
    if (grantError) throw grantError;
    evidenceGuestToken = (grant as { token: string }).token;

    const { error: signOutError } = await platformAuthClient.auth.signOut();
    if (signOutError) throw signOutError;
  });

  test.afterAll(async () => {
    // CI runs this suite against a disposable stack that is stopped without a
    // backup. Retaining its fixtures avoids asking the test to delete immutable
    // audit evidence or regulated rows merely for cleanup.
  });

  test("course assignment completes into a publicly verifiable certificate", async ({ page }) => {
    await page.goto(`/verify/${verificationSlug}`);
    await expect(page.getByText("Valid Certificate")).toBeVisible();
    await expect(page.getByText("Phase Employee")).toBeVisible();
    await expect(
      page.getByText("Phase 1 Public Verification Course"),
    ).toBeVisible();
  });

  test("a reportable incident produces the official state-form PDF", async ({ page }) => {
    const account = accounts.get("org_admin")!;
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe("/app");
    await verifyOrgAdminBrowserMfa(page);
    await page.goto(`/app/incidents/${incidentId}`);
    await page.getByRole("button", { name: "Fill Official DHS Reportable Incident Form" }).click();
    await expect.poll(async () => {
      const { data, error } = await admin.from("incidents").select("state_form_pdf_storage_path").eq("id", incidentId).single();
      if (error) throw error;
      return data.state_form_pdf_storage_path;
    }, { timeout: 30000 }).not.toBeNull();
  });

  test("an enrolled employee checks in through a rotating class QR token", async ({ page }) => {
    const trainer = accounts.get("trainer")!;
    const trainerClient = createClient(supabaseUrl!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: trainerSignInError } = await trainerClient.auth.signInWithPassword({ email: trainer.email, password });
    if (trainerSignInError) throw trainerSignInError;
    const { data: token, error: tokenError } = await trainerClient.rpc("generate_class_checkin_token", { p_class_id: trainingClassId });
    if (tokenError) throw tokenError;

    const employee = accounts.get("employee")!;
    const employeeClient = createClient(supabaseUrl!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: employeeSignInError } = await employeeClient.auth.signInWithPassword({ email: employee.email, password });
    if (employeeSignInError) throw employeeSignInError;
    await page.goto("/login");
    await page.getByLabel("Email").fill(employee.email);
    await page.getByLabel("Password").fill(employee.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe("/me");
    await page.goto(`/checkin/${token}`);
    await expect(page.getByText("You're checked in.")).toBeVisible();
    await expect.poll(async () => {
      const { data, error } = await employeeClient.from("training_class_attendees").select("checked_in_at").eq("class_id", trainingClassId).eq("employee_id", employeeRecordId).single();
      if (error) throw error;
      return data.checked_in_at;
    }).not.toBeNull();
  });

  test("a manager queues an asynchronous compliance binder", async ({ page }) => {
    const account = accounts.get("org_admin")!;
    const requestedAfter = new Date().toISOString();
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe("/app");
    await verifyOrgAdminBrowserMfa(page);
    await page.goto("/app/compliance-binder");
    await page.getByRole("button", { name: "Export Binder PDF" }).click();
    await expect.poll(async () => {
      const { count, error } = await admin.from("binder_export_jobs").select("id", { count: "exact", head: true })
        .eq("requested_by", account.id).gte("requested_at", requestedAfter);
      if (error) throw error;
      return count ?? 0;
    }).toBe(1);
  });

  test("an evidence-room guest accepts terms and sees only granted artifacts", async ({ page }) => {
    await page.goto(`/evidence-access/${evidenceGuestToken}`);
    await expect(page.getByRole("heading", { name: "E2E Survey Evidence" })).toBeVisible();
    await expect(page.getByText("E2E Compliance Binder")).toHaveCount(0);
    await page.getByRole("button", { name: "Accept terms and open the room" }).click();
    await expect(page.getByText("E2E Compliance Binder")).toBeVisible();
    await expect(page.getByText("Compliance binder (PDF)")).toBeVisible();
  });

  test("designated-person portal removes the URL credential and gates resident data on terms", async ({ page }) => {
    await page.goto(`/resident-portal?access=${residentPortalToken}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/resident-portal");
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByRole("heading", { name: "Review portal terms" })).toBeVisible();
    await expect(page.getByText("Portal Resident")).toHaveCount(0);

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await expect(page.getByRole("heading", { name: "Portal Resident" })).toBeVisible();
    await expect(page.getByText(/For emergencies, call 911/)).toBeVisible();

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  });

  test("the demo page exposes no shared credentials and routes guests to sign in", async ({
    page,
  }) => {
    await page.goto("/demo");
    await expect(page.getByText("Demo access")).toBeVisible();
    await expect(
      page.getByText(/does not expose shared demo credentials/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Guest auditor/ }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/login");

    // Guests issued dedicated credentials still get in through the login form.
    await page.getByLabel("Email").fill(guestEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
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

  test("employee invitation creates a usable linked portal account", async () => {
    const account = accounts.get("org_admin")!;
    const inviteClient = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInError } = await inviteClient.auth.signInWithPassword({
      email: account.email,
      password,
    });
    if (signInError || !signInData.session) {
      throw signInError ?? new Error("Org admin sign-in returned no session");
    }
    await verifyOrgAdminClientMfa(inviteClient);
    const { data: elevatedSession, error: elevatedSessionError } =
      await inviteClient.auth.getSession();
    if (elevatedSessionError || !elevatedSession.session) {
      throw elevatedSessionError ?? new Error("Org admin MFA returned no session");
    }

    const suffix = String(Date.now());
    const inviteEmail = `phase1-invited-employee-${suffix}@test.local`;
    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        first_name: "Invited",
        last_name: "Employee",
        email: inviteEmail,
        job_title: "Direct Care Worker",
        status: "active",
      })
      .select("id")
      .single();
    if (employeeError) throw employeeError;

    const inviteResponse = await fetch(`${functionsUrl}/invite-user`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${elevatedSession.session.access_token}`,
        apikey: anonKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: inviteEmail,
        first_name: "Invited",
        last_name: "Employee",
        role: "employee",
        organization_id: organizationId,
        employee_id: employee.id,
        redirect_to: "https://cmcarebase.com/reset-password",
      }),
    });
    const inviteResult = await inviteResponse.json();
    expect(inviteResponse.ok, JSON.stringify(inviteResult)).toBe(true);
    expect(inviteResult.success).toBe(true);
    expect(inviteResult.employee_id).toBe(employee.id);

    const { data: linkedEmployee, error: linkedEmployeeError } = await admin
      .from("employees")
      .select("profile_id")
      .eq("id", employee.id)
      .single();
    if (linkedEmployeeError) throw linkedEmployeeError;
    expect(linkedEmployee.profile_id).toBe(inviteResult.user.id);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, organization_id")
      .eq("id", inviteResult.user.id)
      .single();
    if (profileError) throw profileError;
    expect(profile).toMatchObject({ role: "employee", organization_id: organizationId });
  });

  test("org admin guided onboarding opens the combined employee and portal flow", async ({ page }) => {
    const account = accounts.get("org_admin")!;
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe("/app");
    await verifyOrgAdminBrowserMfa(page);

    await page.getByRole("link", { name: "Onboard Employee" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Add Employee" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Send portal invite" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Create & Send Invite" })).toBeVisible();
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
      if (role === "org_admin") {
        await verifyOrgAdminBrowserMfa(page);
        await page.goto(account.expectedPath);
        await expect(page.locator("h1").first()).toBeVisible();
      } else if (role === "platform_admin" || role === "facility_manager") {
        await expect(page.getByText("Multi-factor verification required")).toBeVisible();
      } else {
        await expect(page.locator("h1").first()).toBeVisible();
      }

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
