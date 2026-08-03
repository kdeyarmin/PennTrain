import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RESIDENT_JOURNEY_STEPS } from "../src/lib/residentJourney";
import { buildIncidentStages } from "../src/lib/incidentStages";

/**
 * The twelve-step resident lifecycle journey (program plan Phase 0, item 3).
 *
 * Steps are declared in `src/lib/residentJourney.ts` and counted by
 * `scripts/check-journey-coverage.mjs`. A step whose registry status is "pending" registers here as
 * `test.fixme` -- it appears in the Playwright report as a known gap rather than quietly not
 * existing, which is the whole point of the plan asking for a *counted* skeleton.
 *
 * This suite runs serially and shares one seeded tenant: the journey is a sequence, and a step that
 * needed its own fixture would not be proving the handover between steps.
 */

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const password = process.env.E2E_ACCOUNT_PASSWORD ?? "";

// Same TOTP derivation as e2e/role-routing.spec.ts. Kept in sync by hand for now -- extracting a
// shared helper means touching the passing role suite, which is its own change.
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
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}

let admin: SupabaseClient;
let organizationId: string;
let facilityId: string;
let adminEmail: string;
let mfaSecret: string;
// A signed-in, MFA-verified client for the journey admin. Some tables are readable by the user
// but deliberately not by service_role, so asserting those through the user is both the only way
// and the more faithful one -- it proves RLS lets the person who did the work see the result.
let userClient: SupabaseClient;
let residentId: string | null = null;
let incidentId: string | null = null;
let employeeEmail: string;
let employeeProfileId: string;

const step = (id: string) => {
  const found = RESIDENT_JOURNEY_STEPS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown journey step "${id}"`);
  return found;
};

/**
 * Collects everything that went wrong underneath the page: console and page errors, failed
 * requests, and 4xx/5xx responses WITH their bodies. The response body is the part that matters --
 * a failed write surfaces in the UI as a toast that has usually vanished by the time a snapshot is
 * taken, while PostgREST puts the actual reason in the payload.
 */
function watchForFailures(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${String(error).slice(0, 200)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // "Failed to load resource" duplicates what the response handler already records, with less
    // detail (no URL, no body). Keeping both means the useful entry is the one that gets pushed out.
    if (message.text().startsWith("Failed to load resource")) return;
    errors.push(`console:${message.text().slice(0, 200)}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed:${request.method()} ${request.url().slice(0, 160)} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", async (response) => {
    if (response.status() < 400) return;
    // Telemetry and platform-status live in Edge Functions, which a local stack often runs without
    // (they need privileges a container may not have) and which the app fails open on by design.
    // Left unfiltered they flood the tail of this list and crowd out the failure being diagnosed.
    if (/\/functions\/v1\/(capture-product-event|get-platform-status)/.test(response.url())) return;
    const body = await response.text().catch(() => "<unreadable>");
    errors.push(`http${response.status()}:${response.url().slice(0, 120)} ${body.slice(0, 300)}`);
  });
  return errors;
}

/**
 * Signs in and waits for the authenticated shell to render.
 *
 * The MFA step-up applies to administrators: the org session policy holds them on an interstitial
 * until an enrolled factor is verified for THIS browser session. Employees are not held there, so
 * the floor steps sign in without it -- which is also the shape of the real thing, since a care
 * worker on a shared device is not enrolling an authenticator mid-shift.
 */
async function signIn(
  page: import("@playwright/test").Page,
  options: { email?: string; landsOn?: string; stepUp?: boolean } = {},
) {
  const email = options.email ?? adminEmail;
  const landsOn = options.landsOn ?? "/app/today";
  const stepUp = options.stepUp ?? true;
  const errors = watchForFailures(page);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe(landsOn);

  if (stepUp) {
    await page.goto("/account/security");
    const code = page.getByLabel("Authenticator code");
    await expect(code).toBeVisible();
    // A TOTP code is only valid for a narrow window; on a loaded CI runner the round trip from
    // "compute the code" to "the server validates it" can occasionally straddle that window, so the
    // server sees an already-expired code. Recomputing and resubmitting a fresh code -- rather than
    // retrying the same one -- is the standard mitigation for exactly this class of flake.
    //
    // The fill/click are wrapped and time-boxed: MfaSettings disables #mfa-code for the whole
    // verify+refreshSession+loadSecurityState round trip and, on success, unmounts it entirely (the
    // "already verified" panel replaces the form). A slow-but-correct first attempt can outlast the
    // "verified" check below, so a naive retry tries to fill an input that's now disabled or already
    // detached and hangs for the rest of the test timeout. Failing that fill/click fast and falling
    // through to a longer "did it actually succeed" wait avoids the hang either way.
    //
    // Root cause of the previous two failed passes: isVisible({ timeout }) does not poll -- it is a
    // single, immediate check, timeout or no. Diagnostic logging showed the "not verified yet" check
    // firing ~12ms after the fill/click failure it followed, not anywhere near 15s later, so the
    // loop was never actually waiting for attempt 1's still-in-flight verify+refresh round trip --
    // it was hammering a disabled input in a tight loop instead. waitFor({ state: "visible" }) is
    // the locator method that actually polls.
    const verified = page.getByText(/session is already verified/i);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const window = Math.floor(Date.now() / 30_000);
      try {
        await code.fill(totpCode(mfaSecret), { timeout: 5000 });
        await page.getByRole("button", { name: "Verify authenticator" }).click({ timeout: 5000 });
      } catch (error) {
        console.log(`[mfa-verify attempt=${attempt} window=${window}] fill/click did not complete: ${String(error).slice(0, 200)}`);
      }
      const succeeded = await verified.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
      if (succeeded) break;
      const statusText = await page.getByRole("status").allTextContents().catch(() => []);
      const path = await page.evaluate(() => window.location.pathname).catch(() => "?");
      console.log(`[mfa-verify attempt=${attempt} window=${window}] not verified yet; path=${path} status text: ${JSON.stringify(statusText)}`
        + (errors.length ? ` errors=${JSON.stringify(errors.slice(-6))}` : " errors=[]"));
      if (attempt === 3) await expect(verified).toBeVisible();
    }
    await page.goto(landsOn);
  }

  let lastState = "";
  const startedAt = Date.now();
  await expect
    .poll(async () => {
      const path = await page.evaluate(() => window.location.pathname).catch(() => "?");
      const headings = await page.getByRole("heading").allTextContents().catch(() => []);
      const gates = await page.locator("[role=status]").allTextContents().catch(() => []);
      const body = await page.evaluate(() => document.body?.innerText.slice(0, 200) ?? "").catch(() => "?");
      const state = `path=${path} headings=${JSON.stringify(headings.slice(0, 4))} gates=${JSON.stringify(gates)} body=${JSON.stringify(body)}`;
      if (state !== lastState) {
        lastState = state;
        console.log(`[signin-shell t=${Math.round((Date.now() - startedAt) / 1000)}s] ${state}`
          + (errors.length ? ` errors=${JSON.stringify(errors.slice(-5))}` : ""));
      }
      return headings.length > 0 ? "shell-rendered" : state + ` errors=${JSON.stringify(errors.slice(-8))}`;
    }, { timeout: 30000 })
    .toBe("shell-rendered");
}

test.describe("resident lifecycle journey", () => {
  // Playwright's 30s default is a whole-test budget, and sign-in alone can spend 20s of it before
  // the journey starts. The first run of this step reported "Test timeout of 30000ms exceeded" at
  // the button, which reads as a missing control but was the test simply running out of time.
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  /**
   * Puts one scheduled task on today's floor queue and returns its requirement id.
   *
   * Tasks are generated from service REQUIREMENTS, not from plan services directly, so the
   * requirement is seeded and the product's own generator builds the schedule -- the times are the
   * product's, not the test's. service_role is used because resident_service_requirements is
   * RPC-only for authenticated users: the product fills it during assessment finalisation through
   * an app_private helper that cannot be called from a client.
   *
   * Each caller passes its own source_key. The floor queue shows today's SCHEDULED tasks only, so a
   * step that documents a task removes it from the list -- a later step sharing one requirement
   * would find an empty queue and no controls to click.
   */
  const seedScheduledTask = async (
    options: { sourceKey: string; serviceName: string; instructions: string },
  ): Promise<string> => {
    const { data: form, error: formError } = await admin
      .from("resident_assessment_forms")
      .select("id, version_number")
      .eq("resident_id", residentId!)
      .limit(1)
      .single();
    if (formError) throw formError;

    const { data: requirement, error: requirementError } = await admin
      .from("resident_service_requirements")
      .insert({
        organization_id: organizationId,
        facility_id: facilityId,
        resident_id: residentId!,
        source_assessment_form_id: form.id,
        source_plan_version: form.version_number,
        source_section: "mobility",
        source_key: options.sourceKey,
        service_code: "mobility." + options.sourceKey,
        service_name: options.serviceName,
        special_instructions: options.instructions,
        frequency: "daily",
        responsible_role: "direct_care",
        effective_from: new Date().toISOString().slice(0, 10),
        status: "active",
      })
      .select("id")
      .single();
    if (requirementError) throw requirementError;

    // The generator's signature is (p_from, p_through, p_requirement_id) -- there is no
    // p_resident_id. Scoping to this requirement keeps each step's assertions about its own task.
    const today = new Date().toISOString().slice(0, 10);
    const { error: generateError } = await admin.rpc("generate_resident_service_tasks" as never, {
      p_from: today,
      p_through: today,
      p_requirement_id: requirement.id,
    } as never);
    if (generateError) throw generateError;
    return requirement.id as string;
  };

  test.beforeAll(async () => {
    if (!supabaseUrl || !serviceRoleKey || !anonKey || !password) {
      throw new Error(
        "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY, and E2E_ACCOUNT_PASSWORD "
        + "are required for the resident lifecycle journey",
      );
    }
    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = String(Date.now());
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .insert({
        name: "Journey Tenant " + suffix,
        slug: "journey-tenant-" + suffix,
        subscription_status: "active",
      })
      .select("id")
      .single();
    if (organizationError) throw organizationError;
    organizationId = organization.id;

    // Both facility types, because the plan's exit gate asks for each to be exercised. The stored
    // code stays "ALR" -- it is the column value, not a label. Every string a user sees says ALF.
    const { data: facilities, error: facilityError } = await admin
      .from("facilities")
      .insert([
        { organization_id: organizationId, name: "Journey PCH", facility_type: "PCH" },
        { organization_id: organizationId, name: "Journey ALF", facility_type: "ALR" },
      ])
      .select("id, facility_type");
    if (facilityError) throw facilityError;
    facilityId = facilities.find((entry) => entry.facility_type === "PCH")!.id;

    adminEmail = `journey-admin-${suffix}@test.local`;
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      app_metadata: { role: "org_admin", organization_id: organizationId },
      user_metadata: { first_name: "Journey", last_name: "Admin" },
    });
    if (userError || !user.user) throw userError ?? new Error("User creation returned no user");

    const { error: profileError } = await admin.rpc("admin_update_profile", {
      p_user_id: user.user.id,
      p_role: "org_admin",
      p_organization_id: organizationId,
      p_is_active: true,
    });
    if (profileError) throw profileError;

    for (const facility of facilities) {
      const { error } = await admin
        .from("facility_assignments")
        .insert({ profile_id: user.user.id, facility_id: facility.id });
      if (error) throw error;
    }

    // Module entitlements. /app/residents belongs to the CareBase pillar, and with no entitlement
    // rows at all the client resolves to core-only and redirects the route away -- which is what a
    // real unentitled tenant should experience, and is why the first run of this step timed out
    // waiting for a button on a page it had already been bounced off.
    const { error: entitlementError } = await admin
      .from("organization_entitlement_grants")
      .insert(
        [
          "modules.carebase",
          "modules.train",
          "modules.workforce",
          "modules.compliance",
          "modules.billing",
          // Survey Day is entitlement-gated separately from the pillars, and its RPCs assert it
          // server-side as well as the client gating the page.
          "survey_day_mode",
        ].map((feature_key) => ({
          organization_id: organizationId,
          feature_key,
          decision: "grant",
          entitlement_value: true,
          reason: "Resident lifecycle journey fixture",
        })),
      );
    if (entitlementError) throw entitlementError;

    // Entitlement is only half the gate. evaluate_feature_access computes
    // `allowed = entitled AND released AND NOT killed`, and with no release_flags row the mode
    // defaults to 'off' -- so a fully entitled org still sees "not enabled for your organization".
    // release_flags is global (keyed by feature_key alone), so this is an upsert, not an insert.
    const { error: releaseError } = await admin
      .from("release_flags")
      .upsert({
        feature_key: "survey_day_mode",
        rollout_mode: "global",
        is_enabled: true,
        owner: "resident-lifecycle-journey",
        change_reason: "Journey fixture exercises the Survey Day workspace end to end",
      }, { onConflict: "feature_key" });
    if (releaseError) throw releaseError;

    // The org-level session policy requires administrators to verify an authenticator before any
    // protected workspace opens. Five CI rounds of "blank shell" were this interstitial: it had no
    // heading, so heading-based instrumentation saw nothing at all. Enroll a factor the same way
    // the role suite does; signIn() verifies it per browser session.
    const adminAuthClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await adminAuthClient.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (signInError) throw signInError;
    const { data: enrollment, error: enrollError } = await adminAuthClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "journey-authenticator",
    });
    if (enrollError || !enrollment) throw enrollError ?? new Error("MFA enrollment returned nothing");
    mfaSecret = enrollment.totp.secret;
    // Verify the factor NOW, api-side, exactly as the role suite does. An enrolled-but-unverified
    // factor is a different state: /account/security offers the enrollment flow for it, not the
    // "Authenticator code" verify input the browser step drives -- which cost a round to learn.
    const { error: verifyError } = await adminAuthClient.auth.mfa.challengeAndVerify({
      factorId: enrollment.id,
      code: totpCode(mfaSecret),
    });
    if (verifyError) throw verifyError;
    userClient = adminAuthClient;

    // A care worker, for the floor steps. The task queue scopes an employee to tasks in their own
    // employees.facility_id that are unassigned or theirs -- no shift assignment involved, which is
    // what the registry's blocker got wrong.
    employeeEmail = `journey-aide-${suffix}@test.local`;
    const { data: aideUser, error: aideError } = await admin.auth.admin.createUser({
      email: employeeEmail,
      password,
      email_confirm: true,
      app_metadata: { role: "employee", organization_id: organizationId },
      user_metadata: { first_name: "Journey", last_name: "Aide" },
    });
    if (aideError || !aideUser.user) throw aideError ?? new Error("Aide creation returned no user");
    employeeProfileId = aideUser.user.id;

    const { error: aideProfileError } = await admin.rpc("admin_update_profile", {
      p_user_id: aideUser.user.id,
      p_role: "employee",
      p_organization_id: organizationId,
      p_is_active: true,
    });
    if (aideProfileError) throw aideProfileError;

    const { error: employeeError } = await admin.from("employees").insert({
      organization_id: organizationId,
      facility_id: facilityId,
      profile_id: aideUser.user.id,
      first_name: "Journey",
      last_name: "Aide",
      email: employeeEmail,
      job_title: "Direct Care Worker",
      status: "active",
    });
    if (employeeError) throw employeeError;
  });

  // -------------------------------------------------------------------------------------------
  // 1. Admit
  // -------------------------------------------------------------------------------------------
  test(`1. ${step("admit").title} ["admit"]`, async ({ page }) => {
    // The body below is complete and stays here to be reinstated. It is gated on the registry so
    // there is exactly one source of truth for whether a step counts as proven: flipping the status
    // in residentJourney.ts turns this test on, and nothing else needs editing.
    test.fixme(step("admit").status === "pending", step("admit").blockedBy ?? "");

    await signIn(page);
    await page.goto("/app/residents");

    // Assert the page before the control on it, and make each failure say which layer failed.
    // Two CI rounds went on "waiting for getByRole(...)" errors that could equally have meant a
    // redirect, a slow shell, or a renamed control. These two assertions distinguish all three:
    // the poll reports where the router actually landed, and the heading dump reports what the
    // page rendered once it stayed put.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
      .toBe("/app/residents");

    // Polled, not read once -- ProtectedRoute renders a heading-less gate spinner while access
    // queries resolve. The poll carries the gate labels too, so if the shell wedges again the
    // failure says which gate ("Loading facility access" vs "Loading CareBase") instead of "[]".
    await expect
      .poll(async () => {
        const headings = await page.getByRole("heading").allTextContents();
        const gates = await page.locator("[role=status]").allTextContents();
        return headings.includes("Residents")
          ? "residents-rendered"
          : `headings=${JSON.stringify(headings)}; gates=${JSON.stringify(gates)}`;
      }, { timeout: 30000 })
      .toBe("residents-rendered");

    await page.getByRole("button", { name: "Add Resident" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Facility *").click();
    await page.getByRole("option", { name: "Journey PCH" }).click();
    await dialog.getByLabel("First Name *").fill("Journey");
    await dialog.getByLabel("Last Name *").fill("Resident");
    await dialog.getByLabel("Admission Date *").fill("2026-07-01");
    await dialog.getByRole("button", { name: "Add Resident" }).click();

    // Asserted against the database, not the list: the step proves a record was admitted, and a
    // row appearing in a table only proves the table rendered something.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("residents")
        .select("id, admission_date, facility_id")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return data;
    }, { timeout: 20000 }).toHaveLength(1);

    const { data: resident, error } = await admin
      .from("residents")
      .select("id, admission_date, facility_id")
      .eq("organization_id", organizationId)
      .single();
    if (error) throw error;
    expect(resident.admission_date).toBe("2026-07-01");
    expect(resident.facility_id).toBe(facilityId);
    residentId = resident.id;
  });

  // -------------------------------------------------------------------------------------------
  // 2. Complete the initial assessment
  //
  // The real path, and the guard is the point. complete_resident_compliance_item(item, document)
  // refuses to mark the item complete without an attached DHS form -- "no exception", in the
  // migration's own words. So the step uploads a signed form the way a facility does and lets the
  // guard be satisfied, rather than reaching for the RPC or relaxing anything.
  //
  // Note what this step is NOT: the "Start review" instruments further down that tab are governed
  // INTERNAL reviews. The page says so itself -- they do not replace the RASP and finalizing one
  // never completes a compliance item. Driving one of those would have been easier and would have
  // proven the wrong thing.
  // -------------------------------------------------------------------------------------------
  test(`2. ${step("initial-assessment").title} ["initial-assessment"]`, async ({ page }) => {
    test.fixme(step("initial-assessment").status === "pending", step("initial-assessment").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to assess");

    await signIn(page);
    await page.goto(`/app/residents/${residentId}?tab=assessments`);

    // Scope to the Initial Assessment row: four checklist items each offer "Upload signed form",
    // and picking by index would silently drift the day an item is added.
    const initialAssessment = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "Initial Assessment" })
      .first();
    await expect(initialAssessment).toBeVisible({ timeout: 20000 });
    await initialAssessment.getByRole("button", { name: "Upload signed form" }).click();

    const upload = page.getByRole("dialog");
    await expect(upload).toBeVisible();
    // A real (if minimal) PDF: the input accepts .pdf/.jpg/.png, and handing it something that is
    // not a PDF would be testing the fixture rather than the workflow.
    await upload.locator('input[type="file"]').setInputFiles({
      name: "signed-rasp.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        + "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
      ),
    });
    await upload.getByRole("button", { name: "Upload & Mark Complete" }).click();

    // Asserted against both halves of the guard: the item is complete AND it points at a stored
    // document. Completion without an attached form is exactly what must never be possible.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_compliance_items")
        .select("item_type, status, completed_date")
        .eq("resident_id", residentId!)
        // PCH stamps this as initial_assessment_15day (the 15-day rule) while ALF uses its own
        // variant, so match the family rather than pinning one facility type's spelling.
        .ilike("item_type", "initial_assessment%");
      if (error) throw error;
      const documents = await admin
        .from("resident_documents")
        .select("id")
        .eq("resident_id", residentId!);
      if (documents.error) throw new Error(documents.error.message);
      return {
        status: data[0]?.status ?? "missing",
        completed: (data[0]?.completed_date ?? null) !== null,
        documents: documents.data?.length ?? 0,
      };
    }, { timeout: 30000 }).toEqual({ status: "compliant", completed: true, documents: 1 });
  });

  // -------------------------------------------------------------------------------------------
  // 3. Generate a support plan from the assessment
  //
  // Drives the path a user can actually reach. There used to be two proposal engines in the schema
  // and this note warned which one was wired; 20260726220000 merged them, so there is now exactly
  // one -- generate_support_plan_proposal(assessment_form_id) -- and it both evaluates the mapping
  // rules' conditions and emits the shape the plan merge consumes.
  //
  // The finalized assessment form is seeded rather than driven: producing one is the RASP prep
  // flow, which is its own workflow and not what this step claims to prove. What IS driven is the
  // part the step is about -- generating a proposal from that assessment and accepting it.
  // -------------------------------------------------------------------------------------------
  test(`3. ${step("support-plan").title} ["support-plan"]`, async ({ page }) => {
    test.fixme(step("support-plan").status === "pending", step("support-plan").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to plan for");

    // Inserted as the user: service_role lacks INSERT on resident_assessment_forms, the same grant
    // asymmetry already seen on incident_notifications. Going through the user is also the honest
    // shape -- a facility's own account is what creates these.
    const { error: formError } = await userClient.from("resident_assessment_forms").insert({
      organization_id: organizationId,
      facility_id: facilityId,
      resident_id: residentId!,
      form_type: "RASP",
      reason: "initial",
      status: "finalized",
      content: {
        transfer_assistance: "one_person",
        ambulation_status: "walker",
        falls_last_90_days: 2,
      },
    });
    if (formError) throw formError;

    await signIn(page);
    await page.goto(`/app/residents/${residentId}?tab=support-plan`);

    await page.getByRole("button", { name: "Check assessment for changes" }).click();

    // A proposal exists and is awaiting a decision -- the state that matters, because a proposal
    // auto-applied to the plan would be the product deciding care on its own.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("support_plan_proposals")
        .select("id, state")
        .eq("resident_id", residentId!);
      if (error) throw error;
      return data.map((row) => row.state).sort();
    }, { timeout: 30000 }).toContain("proposed");

    // Accepting requires a rationale of its own: the decision is recorded, not just the outcome.
    await page.getByRole("button", { name: /Review/ }).first().click();
    const decision = page.getByRole("dialog");
    await expect(decision).toBeVisible();
    await decision.getByRole("textbox").first().fill(
      "Mobility findings match the fall this resident had; the standby assistance belongs in the plan.",
    );
    await decision.getByRole("button", { name: /^(Save|Confirm|Record)/ }).first().click();

    await expect.poll(async () => {
      const { data, error } = await admin
        .from("support_plan_proposals")
        // review_reason, NOT rationale. `rationale` is written when the proposal is GENERATED (the
        // mapping rule's justification); review_support_plan_proposal writes the reviewer's words to
        // review_reason. Asserting `rationale` passed while proving nothing about the decision.
        .select("state, review_reason")
        .eq("resident_id", residentId!);
      if (error) throw error;
      const accepted = data.find((row) => row.state === "accepted");
      return accepted
        ? { accepted: true, reviewerRecorded: (accepted.review_reason ?? "").includes("standby assistance") }
        : { accepted: false, reviewerRecorded: false };
    }, { timeout: 30000 }).toEqual({ accepted: true, reviewerRecorded: true });
  });

  // -------------------------------------------------------------------------------------------
  // 4. Deliver and document a service
  //
  // A care worker signs in, sees the day's tasks for their own facility, and documents one. The
  // queue scopes an employee to tasks in their employees.facility_id that are unassigned or theirs
  // -- no shift assignment, which is what the old blocker claimed.
  // -------------------------------------------------------------------------------------------
  test(`4. ${step("deliver-services").title} ["deliver-services"]`, async ({ page }) => {
    test.fixme(step("deliver-services").status === "pending", step("deliver-services").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to care for");

    const requirementId = await seedScheduledTask({
      sourceKey: "standby_ambulation",
      serviceName: "Standby assistance during ambulation",
      instructions: "Remain within arm's reach while the resident is walking.",
    });

    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_service_task_instances")
        .select("id")
        .eq("requirement_id", requirementId);
      if (error) throw error;
      return data.length;
    }, { timeout: 20000 }).toBeGreaterThan(0);

    await signIn(page, { email: employeeEmail, landsOn: "/me", stepUp: false });
    await page.goto("/me/floor");

    await page.getByRole("button", { name: /Resident tasks/ }).click();
    await expect(page.getByText("Standby assistance during ambulation").first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Document", exact: true }).first().click();

    const document = page.getByRole("dialog");
    await expect(document).toBeVisible();
    // No Save step: routine documentation is deliberately one tap, and the dialog closes itself.
    // Adding a Save click here would have made the test demand a confirmation the product does not
    // have -- and its absence is a design decision (DocumentCareDialog says so outright).
    await document.getByRole("button", { name: "Completed as planned" }).click();
    await expect(document).toBeHidden({ timeout: 20000 });

    // Attributable: the point of documenting care is that a named person did it at a known time.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_service_task_instances")
        .select("status, performed_at, completed_by_employee_id, completion_response")
        .eq("resident_id", residentId!);
      if (error) throw error;
      const done = data.find((row) => row.status === "completed");
      return done
        ? {
            response: done.completion_response,
            timed: done.performed_at !== null,
            attributed: done.completed_by_employee_id !== null,
          }
        : { response: null, timed: false, attributed: false };
    }, { timeout: 30000 }).toEqual({
      response: "completed_as_planned",
      timed: true,
      attributed: true,
    });
  });

  // -------------------------------------------------------------------------------------------
  // 5. Record increased assistance
  //
  // Care given outside the plan. It matters because a resident quietly needing more help than the
  // plan says is the signal that the plan is out of date -- and it is invisible if the only thing
  // a worker can record is whether the scheduled task happened.
  // -------------------------------------------------------------------------------------------
  test(`5. ${step("increased-assistance").title} ["increased-assistance"]`, async ({ page }) => {
    test.fixme(step("increased-assistance").status === "pending", step("increased-assistance").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete");

    // "Extra care" hangs off a task row, and step 4 documented the only one -- a documented task
    // leaves the SCHEDULED queue, so this step seeds its own rather than depending on leftovers.
    const requirementId = await seedScheduledTask({
      sourceKey: "transfer_assist",
      serviceName: "Assistance with transfers",
      instructions: "Assist from bed to chair.",
    });
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_service_task_instances")
        .select("id")
        .eq("requirement_id", requirementId);
      if (error) throw error;
      return data.length;
    }, { timeout: 20000 }).toBeGreaterThan(0);

    await signIn(page, { email: employeeEmail, landsOn: "/me", stepUp: false });
    await page.goto("/me/floor");
    await page.getByRole("button", { name: /Resident tasks/ }).click();

    await page.getByRole("button", { name: /Extra care/ }).first().click();
    const extra = page.getByRole("dialog");
    await expect(extra).toBeVisible();
    // First tap selects the kind and reveals the note; the footer's Record submits. (Tapping the
    // same kind twice would also submit, which would skip the note entirely.)
    await extra.getByRole("button", { name: "Extra transfer help" }).click();
    await extra.getByLabel(/Anything worth noting/).fill(
      "Needed two-person assistance to stand; plan currently says standby only.",
    );
    await extra.getByRole("button", { name: "Record" }).click();
    await expect(extra).toBeHidden({ timeout: 20000 });

    // The kind and the note are asserted, not just row presence: "a row exists" would pass on any
    // unscheduled service and prove nothing about what the worker actually recorded.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_unscheduled_services")
        .select("service_kind, note, recorded_by_profile_id")
        .eq("resident_id", residentId!);
      if (error) throw error;
      const row = data.find((entry) => entry.service_kind === "extra_transfer_assistance");
      return row
        ? {
            captured: true,
            noted: (row.note ?? "").includes("two-person assistance"),
            attributed: row.recorded_by_profile_id !== null,
          }
        : { captured: false, noted: false, attributed: false };
    }, { timeout: 30000 }).toEqual({ captured: true, noted: true, attributed: true });
  });

  // -------------------------------------------------------------------------------------------
  // 6. Review a change of condition
  //
  // The detector is a set of published rules over records staff already made -- deliberately not a
  // score. This step drives the "repeated unscheduled services" rule: five or more in fourteen days
  // raises a signal, which is why the fixture is a series of records over time rather than one row.
  //
  // The signal is a prompt, never a record. ResidentChangeSignalsSection says so outright ("these
  // detections never create one on their own"), so the disposition has to be a human opening the
  // change-of-condition record and stating a decision. Asserting only that the card appeared would
  // prove the detector and nothing about the review.
  // -------------------------------------------------------------------------------------------
  test(`6. ${step("change-of-condition").title} ["change-of-condition"]`, async ({ page }) => {
    test.fixme(step("change-of-condition").status === "pending", step("change-of-condition").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to review");

    // Spread across the detector's window rather than stamped at one instant: the rule counts what
    // happened over fourteen days, and a fixture that piles them onto one timestamp would pass the
    // count while testing nothing about the window.
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const { error: seedError } = await admin.from("resident_unscheduled_services").insert(
      [
        { service_kind: "unscheduled_toileting", days: 1 },
        { service_kind: "unscheduled_toileting", days: 3 },
        { service_kind: "extra_transfer_assistance", days: 5 },
        { service_kind: "additional_hygiene", days: 8 },
        { service_kind: "unplanned_safety_check", days: 11 },
      ].map((entry) => ({
        organization_id: organizationId,
        facility_id: facilityId,
        resident_id: residentId!,
        service_kind: entry.service_kind,
        occurred_at: daysAgo(entry.days),
        recorded_by_profile_id: employeeProfileId,
        note: "Recorded on the floor at the time of care.",
      })),
    );
    if (seedError) throw seedError;

    await signIn(page);
    await page.goto(`/app/residents/${residentId}`);

    // The signal, with its evidence. The count is left open: step 5 records one of these through
    // the UI, so pinning an exact number would make this step fail whenever that one lands first.
    // No ancestor scoping -- the section's title is a styled div, not a heading, so climbing from it
    // lands somewhere arbitrary. These strings only appear on a rendered signal card.
    await expect(page.getByText(/unscheduled services in 14 days/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("unscheduled toileting × 2")).toBeVisible();
    // The evidence window, which is what makes it a trend rather than a tally.
    await expect(page.getByText(/Supporting records ·/)).toBeVisible();

    // The disposition: a reviewer opens the record and states a decision.
    await page.goto(`/app/residents/${residentId}?tab=incidents`);
    await page.getByRole("button", { name: /Log change of condition/ }).click();

    const review = page.getByRole("dialog");
    await expect(review).toBeVisible();
    await review.getByLabel("Immediate observations *").fill(
      "Five unscheduled services in two weeks, mostly toileting; resident is asking for help more often.",
    );
    await review.getByLabel("Immediate action taken *").fill(
      "Increased toileting checks and referred the pattern for a support-plan review.",
    );
    // Both notifications must leave 'pending' for the record to be dispositioned rather than parked.
    await review.getByLabel("Provider notification").click();
    await page.getByRole("option", { name: "completed" }).click();
    await review.getByLabel("Designated-person notification").click();
    await page.getByRole("option", { name: "completed" }).click();
    await review.getByLabel("Incident report decision *").click();
    await page.getByRole("option", { name: "Incident report not required" }).click();

    await review.getByRole("button", { name: /Start Guided Workflow/ }).click();
    await expect(review).toBeHidden({ timeout: 30000 });

    // The reviewer's words and decision are on the record -- not merely that a row appeared.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_change_events")
        .select("status, incident_decision, immediate_observations, provider_notification_status")
        .eq("resident_id", residentId!);
      if (error) throw error;
      const event = data[0];
      return event
        ? {
            opened: true,
            decided: event.incident_decision === "not_required",
            observed: (event.immediate_observations ?? "").includes("unscheduled services"),
            notified: event.provider_notification_status === "completed",
          }
        : { opened: false, decided: false, observed: false, notified: false };
    }, { timeout: 30000 }).toEqual({ opened: true, decided: true, observed: true, notified: true });
  });

  // -------------------------------------------------------------------------------------------
  // 7. Revise the support plan
  //
  // Runs the whole lifecycle, because until 20260726210000 it could not run at all: a first plan
  // had no way to acquire content, so "Submit for review" stayed disabled forever. Accepting the
  // proposal in step 3 now fills the draft, which is what makes this reachable.
  //
  // draft -> in_review -> awaiting participation -> awaiting signature -> effective, then a
  // revision that supersedes it while keeping the prior version on the record.
  // -------------------------------------------------------------------------------------------
  test(`7. ${step("plan-revision").title} ["plan-revision"]`, async ({ page }) => {
    test.fixme(step("plan-revision").status === "pending", step("plan-revision").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to plan for");

    await signIn(page);
    await page.goto(`/app/residents/${residentId}?tab=support-plan`);

    // The draft exists and carries the accepted proposal's content.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_support_plans")
        .select("state, version_number, needs, services")
        .eq("resident_id", residentId!);
      if (error) throw error;
      const draft = data.find((row) => row.state === "draft");
      return draft
        ? { hasContent: (draft.needs as unknown[]).length + (draft.services as unknown[]).length > 0 }
        : { hasContent: false };
    }, { timeout: 20000 }).toEqual({ hasContent: true });

    await page.reload();
    await page.getByRole("button", { name: "Submit for review" }).click();

    // Clinical review comes before participation. It has no evidence dialog of its own, so it is
    // offered through the shared transition table -- the UI only ever offers edges the server
    // accepts, which is why the label is generated from the state name.
    await page.getByRole("button", { name: "Move to awaiting resident participation" }).click();
    const toParticipation = page.getByRole("dialog");
    await expect(toParticipation).toBeVisible();
    // No reason field on this edge: transitionRequiresReason() asks for one only where the move is
    // a judgement (returning for revision), not where it is simply the next stage.
    await toParticipation.getByRole("button", { name: "Confirm" }).click();

    await page.getByRole("button", { name: "Record participation" }).click();
    const participation = page.getByRole("dialog");
    await expect(participation).toBeVisible();
    await participation.getByLabel("Notes").fill("Resident and daughter took part in the review.");
    await participation.getByRole("button", { name: "Record participation" }).click();

    await page.getByRole("button", { name: "Record signature" }).click();
    const signature = page.getByRole("dialog");
    await expect(signature).toBeVisible();
    await signature.getByRole("button", { name: "Record outcome" }).click();

    await page.getByRole("button", { name: "Approve" }).click();
    const approve = page.getByRole("dialog");
    await expect(approve).toBeVisible();
    // Approval is gated on an explicit attestation; the button stays disabled without it, which is
    // the point -- activating a care plan should be a deliberate act.
    await approve.getByRole("checkbox").check();
    await approve.getByRole("button", { name: "Approve & activate" }).click();

    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_support_plans")
        .select("state, version_number")
        .eq("resident_id", residentId!);
      if (error) throw error;
      // "active", not "effective": approve_support_plan's original body wrote 'effective', but the
      // lifecycle the product runs on settles at 'active'. Asserting the stale name would have this
      // step waiting for a state nothing produces.
      return data.filter((row) => row.state === "active").length;
    }, { timeout: 30000 }).toBe(1);

    // The revision: a new draft carries the prior plan's content forward, and approving it
    // supersedes the old version rather than overwriting it. A plan that replaced its predecessor
    // in place would leave a facility unable to say what the care plan was on any earlier date.
    await page.reload();
    await page.getByRole("button", { name: "Start new draft" }).click();

    await expect.poll(async () => {
      const { data, error } = await admin
        .from("resident_support_plans")
        .select("state, version_number, services")
        .eq("resident_id", residentId!)
        .order("version_number");
      if (error) throw error;
      const versions = data.map((row) => row.version_number);
      const draft = data.find((row) => row.state === "draft");
      return {
        versions: versions.length,
        priorRetained: data.some((row) => row.state === "active"),
        // The revision starts from the plan in force, not from nothing.
        draftInherited: draft ? (draft.services as unknown[]).length > 0 : false,
      };
    }, { timeout: 30000 }).toEqual({ versions: 2, priorRetained: true, draftInherited: true });
  });

  // -------------------------------------------------------------------------------------------
  // 8. Report a fall
  //
  // Two stages, because that is how the product works: intake records what happened, and the
  // pathway is chosen afterwards on the incident record. "Fall" is not an intake type -- the
  // pathway maps to significant_injury -- so the step reports the injury and then assigns the Fall
  // pathway, which is exactly the sequence a facility follows.
  // -------------------------------------------------------------------------------------------
  test(`8. ${step("fall").title} ["fall"]`, async ({ page }) => {
    test.fixme(step("fall").status === "pending", step("fall").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to fall");

    const errors = watchForFailures(page);
    await signIn(page);
    await page.goto("/app/incidents");
    // Level 1: the nav also carries an "Incidents" heading, and an unscoped match is a strict-mode
    // violation rather than a missing page.
    await expect(
      page.getByRole("heading", { level: 1, name: "Incidents" }),
    ).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: "Report Incident" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Each selection is asserted to have taken. handleSubmit returns SILENTLY when the chosen
    // facility is not in its lookup, so an unset combobox otherwise surfaces only as "no incident
    // was created" with no failed request and no toast to point at.
    const choose = async (label: string, option: string) => {
      await dialog.getByLabel(label).click();
      await page.getByRole("option", { name: option, exact: true }).click();
      await expect(dialog.getByLabel(label)).toHaveText(new RegExp(option));
    };
    await choose("Facility *", "Journey PCH");
    await choose("Incident Type *", "Significant Injury");
    await dialog.getByLabel("Occurred At *").fill("2026-07-20T09:30");
    await choose("Severity *", "Moderate");
    await dialog.getByLabel("Narrative *").fill(
      "Resident was found on the floor beside the bed and assisted up; no visible injury.",
    );
    await dialog.getByRole("button", { name: "Report Incident" }).click();


    // On failure this reports what the backend actually said. A save that fails shows a toast that
    // is gone by the time a snapshot is taken, so "count is still 0" on its own says nothing.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("incidents")
        .select("id")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return data.length === 1
        ? "incident-created"
        : `incidents=${data.length}; errors=${JSON.stringify(errors.slice(-6))}`;
    }, { timeout: 20000 }).toBe("incident-created");

    const { data: incident, error: incidentError } = await admin
      .from("incidents")
      .select("id")
      .eq("organization_id", organizationId)
      .single();
    if (incidentError) throw incidentError;
    incidentId = incident.id;

    // Stage two: assign the pathway on the record itself.
    await page.goto(`/app/incidents/${incidentId}`);
    await page.getByRole("button", { name: "Choose pathway" }).click();
    const pathwayDialog = page.getByRole("dialog");
    await expect(pathwayDialog).toBeVisible();
    await pathwayDialog.getByLabel("Pathway").click();
    await page.getByRole("option", { name: "Fall" }).click();
    // "Save progress" rather than "Mark complete": this step proves the pathway is assigned and the
    // deadlines computed, not that every investigation question has been answered -- that is step 9.
    await pathwayDialog.getByRole("button", { name: "Save progress" }).click();

    // Notification deadlines are the half of this that matters most: a pathway with no clock is a
    // questionnaire, and the 2-hour hotline deadline is the thing a facility actually misses.
    await expect.poll(async () => {
      const [incidentRow, notifications] = await Promise.all([
        admin.from("incidents").select("pathway_key, pathway_version").eq("id", incidentId!).single(),
        // Read as the user, not the service role: service_role holds SELECT on incidents but not on
        // incident_notifications, so a service-role read here returns a permission error that this
        // assertion would otherwise quietly report as "no deadlines".
        userClient.from("incident_notifications").select("id, due_at").eq("incident_id", incidentId!),
      ]);
      if (notifications.error) throw new Error(`notifications read failed: ${notifications.error.message}`);
      return {
        pathway: incidentRow.data?.pathway_key ?? null,
        versionPinned: (incidentRow.data?.pathway_version ?? null) !== null,
        withDeadlines: (notifications.data ?? []).filter((row) => row.due_at !== null).length > 0,
      };
    }, { timeout: 20000 }).toEqual({ pathway: "fall", versionPinned: true, withDeadlines: true });
  });

  // -------------------------------------------------------------------------------------------
  // 9. Investigate the incident
  //
  // Two claims, and the second is the one that matters: the stages are DERIVED from recorded
  // evidence rather than ticked off by hand, and the database refuses to close an incident whose
  // evidence is incomplete. The refusal is asserted against the real guard, not a UI affordance --
  // a disabled button proves the button is disabled, not that the record is protected.
  // -------------------------------------------------------------------------------------------
  test(`9. ${step("investigation").title} ["investigation"]`, async ({ page }) => {
    test.fixme(step("investigation").status === "pending", step("investigation").blockedBy ?? "");
    test.skip(incidentId === null, "step 8 did not complete, so there is no incident to investigate");

    await signIn(page);
    await page.goto(`/app/incidents/${incidentId}`);
    await expect(page.getByText("Close-loop checklist")).toBeVisible({ timeout: 20000 });

    // Closure is refused BEFORE the evidence exists. Attempted as the user, against the table the
    // trigger guards, so this proves the record is protected rather than the screen.
    const prematureClose = await userClient
      .from("incidents")
      .update({ status: "closed" })
      .eq("id", incidentId!);
    expect(prematureClose.error?.message ?? "").toMatch(/final report|approve/i);

    await page.getByRole("button", { name: "Record" }).first().click();
    const record = page.getByRole("dialog");
    await expect(record).toBeVisible();
    await record.getByLabel("Immediate response").fill(
      "Resident assisted up, vitals taken, physician notified within the hour.",
    );
    await record.getByLabel("Findings").fill(
      "No witness. Floor was dry. Resident reported reaching for the call bell.",
    );
    await record.getByLabel("Root cause").fill(
      "Call bell was out of reach from the bed, so the resident self-transferred.",
    );
    await record.getByLabel("Method used").click();
    await page.getByRole("option").first().click();
    await record.getByRole("button", { name: "Save" }).click();

    // The stages are recomputed from the stored row by the same pure function the UI renders from,
    // so this asserts derivation rather than re-asserting whatever the screen happened to show.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("incidents")
        .select("*")
        .eq("id", incidentId!)
        .single();
      if (error) throw error;
      const notifications = await userClient
        .from("incident_notifications")
        .select("*")
        .eq("incident_id", incidentId!);
      if (notifications.error) throw new Error(notifications.error.message);
      const stages = buildIncidentStages({
        incident: data as never,
        notifications: (notifications.data ?? []) as never,
        correctiveActions: [],
        assessmentReviewFinalized: false,
        supportPlanRevisedAfterIncident: false,
      });
      const byKey = new Map(stages.map((stage) => [stage.key, stage.status]));
      return {
        stageCount: stages.length,
        immediate: byKey.get("immediate_response") ?? "missing",
        rootCause: byKey.get("root_cause") ?? "missing",
      };
    }, { timeout: 20000 }).toEqual({
      stageCount: 11,
      immediate: "complete",
      rootCause: "complete",
    });

    // And closure is still refused: recording an investigation is not the same as finishing one.
    const stillRefused = await userClient
      .from("incidents")
      .update({ status: "closed" })
      .eq("id", incidentId!);
    expect(stillRefused.error?.message ?? "").toMatch(/final report|approve/i);
  });

  // -------------------------------------------------------------------------------------------
  // 10. Escalate a pattern into QAPI
  //
  // The thresholds are published constants (QAPI_THRESHOLDS), which is the point: a facility can
  // disagree with "three falls by one resident" explicitly rather than argue with a score. This
  // step crosses that one and opens the project the recommendation suggests.
  //
  // The pattern key is what makes the project traceable back to the trend that justified it, and
  // the unique index on (organization, facility, pattern_key) is what stops the same pattern
  // opening a second project -- so the key, not just the row, is what this asserts.
  // -------------------------------------------------------------------------------------------
  test(`10. ${step("qapi").title} ["qapi"]`, async ({ page }) => {
    test.fixme(step("qapi").status === "pending", step("qapi").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to trend");

    // Three falls spread across the 90-day window the dashboard defaults to. The dates are spread
    // deliberately: a trend is a claim about a period, and three rows sharing one timestamp would
    // satisfy the count while saying nothing about the window the recommendation cites.
    //
    // Created through create_incident_atomic and save_incident_pathway as the signed-in user, not
    // by a service-role insert: service_role holds no INSERT on incidents, and the fix for that is
    // to use the product's own path, never to widen a grant so a fixture is easier to write.
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    for (const days of [10, 35, 60]) {
      const { data: fall, error: fallError } = await userClient.rpc("create_incident_atomic" as never, {
        p_organization_id: organizationId,
        p_facility_id: facilityId,
        p_incident_type: "significant_injury",
        p_occurred_at: daysAgo(days),
        p_resident_id: residentId!,
        p_resident_identifier_snapshot: null,
        p_location_detail: "Room 12",
        p_narrative: "Resident was found on the floor beside the bed and assisted up.",
        p_severity: "moderate",
        // Required, and required to differ per fall: the key is what stops a double-submitted
        // report becoming two incidents, so one shared key here would silently seed a single fall.
        p_idempotency_key: `journey-fall-${residentId}-${days}`,
      } as never);
      if (fallError) throw fallError;
      // The pathway is what makes it a fall to the trend engine: incident_type is
      // 'significant_injury', and FALL_PATHWAYS keys off pathway_key alone.
      const { error: pathwayError } = await userClient.rpc("save_incident_pathway" as never, {
        p_incident_id: (fall as unknown as { id: string }).id,
        p_pathway_key: "fall",
        p_answers: {},
      } as never);
      if (pathwayError) throw pathwayError;
    }

    await signIn(page);
    await page.goto("/app/qapi");

    // Nothing on this dashboard renders until a facility is chosen -- the trends are a claim about
    // one facility's records, and the org here holds two.
    await page.getByRole("combobox").filter({ hasText: /Select facility|Journey/ }).first().click();
    await page.getByRole("option", { name: "Journey PCH" }).click();

    // The recommendation, with the threshold it crossed shown next to it. Naming the resident in
    // the match keeps this from passing on somebody else's pattern.
    const recommendation = page
      .getByText("Repeated falls — Journey Resident")
      .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
    await expect(recommendation).toBeVisible({ timeout: 30000 });
    await expect(recommendation.getByText(/3 or more falls by one resident/)).toBeVisible();

    await recommendation.getByRole("button", { name: "Open a QAPI project" }).click();
    const projectDialog = page.getByRole("dialog");
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByLabel("Project lead").click();
    await page.getByRole("option").first().click();
    await projectDialog.getByRole("button", { name: /Open project/ }).click();
    await expect(projectDialog).toBeHidden({ timeout: 30000 });

    // Linked to its pattern key, not merely created: a project with a null key cannot be traced
    // back to the trend that justified it, and nothing stops the same pattern opening another.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("qapi_projects")
        .select("pattern_key, problem_statement, facility_id")
        .eq("organization_id", organizationId);
      if (error) throw error;
      const project = data.find((row) => row.pattern_key === `repeated_falls_resident:${residentId}`);
      return project
        ? { opened: true, stated: (project.problem_statement ?? "").length > 10 }
        : { opened: false, stated: false, keys: data.map((row) => row.pattern_key) };
    }, { timeout: 30000 }).toEqual({ opened: true, stated: true });
  });

  // -------------------------------------------------------------------------------------------
  // 11. Produce a survey packet
  //
  // Reachable now for two reasons that were previously blockers: the fixture holds the
  // survey_day_mode entitlement, and signIn() steps the session up to aal2, which
  // assert_survey_day_manager requires before any write.
  // -------------------------------------------------------------------------------------------
  test(`11. ${step("survey-packet").title} ["survey-packet"]`, async ({ page }) => {
    test.fixme(step("survey-packet").status === "pending", step("survey-packet").blockedBy ?? "");

    await signIn(page);
    await page.goto(`/app/survey-day?facility=${facilityId}`);
    await expect(page.getByRole("heading", { name: "Survey Day", level: 1 })).toBeVisible();

    // Report the gate rather than time out on a missing control: when Survey Day is not enabled the
    // page renders an explanatory card instead of the activation button, and "button never appeared"
    // does not say which of entitlement or release flag was missing.
    await expect
      .poll(async () => (await page.getByRole("button", { name: "Start Survey Day" }).count()) > 0
        ? "activation-available"
        : `no activation control; page says ${JSON.stringify(
            (await page.locator("main, body").first().innerText()).slice(0, 300))}`,
        { timeout: 20000 })
      .toBe("activation-available");

    // Activation is deliberately behind a confirmation: starting Survey Day writes an audit event.
    await page.getByRole("button", { name: "Start Survey Day" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Start Survey Day" }).click();
    await expect(page.getByText(/Survey Day active/)).toBeVisible({ timeout: 20000 });

    // The log section is lazy-loaded, so its controls arrive after the shell. Matched by text, not
    // by heading role: shadcn's CardTitle renders a div, so these section titles are not headings.
    await expect(page.getByText("Who is here")).toBeVisible({ timeout: 20000 });

    await page.getByLabel("Name", { exact: true }).fill("R. Surveyor");
    await page.getByRole("button", { name: "Record surveyor" }).click();

    await page.getByLabel("New request").fill("Staffing schedules for the last 30 days");
    await page.getByRole("button", { name: "Record request" }).click();

    await page.getByPlaceholder("What happened, in plain words").fill(
      "Surveyor observed the lunch service in the main dining room.",
    );
    await page.getByRole("button", { name: "Record entry" }).click();

    await page.getByRole("button", { name: "Record packet assembled" }).click();

    // Asserted against the record, not the screen: the step proves the session captured who was
    // here, what they asked for, and what was seen -- and that assembling a packet was itself
    // recorded, which is the only durable trace of somebody taking a position on the survey.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("survey_day_sessions")
        .select("id, status")
        .eq("organization_id", organizationId)
        .eq("status", "active");
      if (error) throw error;
      return data.length;
    }, { timeout: 20000 }).toBe(1);

    const { data: session, error: sessionError } = await admin
      .from("survey_day_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .single();
    if (sessionError) throw sessionError;

    await expect.poll(async () => {
      const [surveyors, requests, observations, assembled] = await Promise.all([
        admin.from("survey_day_surveyors").select("id").eq("session_id", session.id),
        admin.from("survey_day_requests").select("id, status").eq("session_id", session.id),
        admin.from("survey_day_observations").select("id").eq("session_id", session.id),
        admin.from("survey_day_events").select("id").eq("session_id", session.id)
          .eq("event_type", "packet_assembled"),
      ]);
      return {
        surveyors: surveyors.data?.length ?? 0,
        requests: requests.data?.length ?? 0,
        observations: observations.data?.length ?? 0,
        assembled: assembled.data?.length ?? 0,
      };
    }, { timeout: 20000 }).toEqual({ surveyors: 1, requests: 1, observations: 1, assembled: 1 });

    // The packet read composes all of it, and reports the outstanding request as open -- the number
    // that matters while surveyors are still in the building.
    const { data: packet, error: packetError } = await admin
      .rpc("get_survey_day_packet", { p_session_id: session.id });
    if (packetError) throw packetError;
    expect((packet as { openRequests: number }).openRequests).toBe(1);
  });

  // -------------------------------------------------------------------------------------------
  // 12. Discharge
  // -------------------------------------------------------------------------------------------
  test(`12. ${step("discharge").title} ["discharge"]`, async ({ page }) => {
    test.fixme(step("discharge").status === "pending", step("discharge").blockedBy ?? "");
    test.skip(residentId === null, "step 1 did not complete, so there is no resident to discharge");

    await signIn(page);
    await page.goto(`/app/residents/${residentId}`);
    // residentDisplayName renders "Last, First", not "First Last". Level 1 because the name also
    // appears as an h2 in the banner breadcrumb, and an unscoped match is a strict-mode violation.
    await expect(
      page.getByRole("heading", { level: 1, name: "Resident, Journey" }),
    ).toBeVisible({ timeout: 20000 });

    await page.getByRole("combobox", { name: "Resident status" }).click();
    await page.getByRole("option", { name: "Discharged" }).click();

    // The status and the date move together: a discharged resident with no discharge date is a
    // census record nobody can reconcile later.
    await expect.poll(async () => {
      const { data, error } = await admin
        .from("residents")
        .select("status, discharge_date")
        .eq("id", residentId!)
        .single();
      if (error) throw error;
      return { status: data.status, hasDate: data.discharge_date !== null };
    }, { timeout: 20000 }).toEqual({ status: "discharged", hasDate: true });
  });

  // -------------------------------------------------------------------------------------------
  // 2-10. Declared, not yet proven.
  //
  // Registered from the registry so the count in the Playwright report and the count in
  // scripts/check-journey-coverage.mjs cannot disagree. Each carries its real blocker.
  // -------------------------------------------------------------------------------------------
  // Every id with a `test(...)` body above. Hand-maintained lists drift: this one was written when
  // ten steps had bodies and was not updated when change-of-condition and qapi gained theirs, so
  // un-marking either as pending would have produced BOTH the real body (self-gated on the
  // registry) and a generated placeholder -- two tests for one step, one of them a lie.
  //
  // Kept as an explicit list rather than derived, because deriving it from the registry's `status`
  // is what it must be checked AGAINST: if it were `status === "implemented"` this loop could never
  // fire and the placeholder mechanism would be silently dead.
  const WITH_WRITTEN_BODIES = new Set([
    "admit", "initial-assessment", "support-plan", "deliver-services", "increased-assistance",
    "change-of-condition", "plan-revision", "fall", "investigation", "qapi", "survey-packet",
    "discharge",
  ]);
  for (const pending of RESIDENT_JOURNEY_STEPS.filter(
    (entry) => entry.status === "pending" && !WITH_WRITTEN_BODIES.has(entry.id),
  )) {
    test(`${pending.ordinal}. ${pending.title}`, () => {
      test.fixme(true, `${pending.proves} Blocked: ${pending.blockedBy}`);
    });
  }

  // The point of a serial journey is that one record travels through it. This asserts the tenant
  // still holds exactly one resident -- a step that quietly created its own would pass its own
  // assertions while proving nothing about the handover.
  test("the journey's resident is a single record carried end to end", async () => {
    test.skip(residentId === null, "step 1 did not complete");
    const { data, error } = await admin
      .from("residents")
      .select("id")
      .eq("organization_id", organizationId);
    if (error) throw error;
    expect(data.map((row) => row.id)).toEqual([residentId]);
  });
});
