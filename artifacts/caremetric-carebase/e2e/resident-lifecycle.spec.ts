import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RESIDENT_JOURNEY_STEPS } from "../src/lib/residentJourney";

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

/** Signs in and lands on the authenticated home. */
async function signIn(page: import("@playwright/test").Page) {
  const errors = watchForFailures(page);

  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe("/app/today");

  // Step up to aal2: the session policy holds admins on the MFA interstitial until the enrolled
  // factor is verified for THIS browser session. Mirrors verifyOrgAdminBrowserMfa in the role suite.
  await page.goto("/account/security");
  const code = page.getByLabel("Authenticator code");
  await expect(code).toBeVisible();
  await code.fill(totpCode(mfaSecret));
  await page.getByRole("button", { name: "Verify authenticator" }).click();
  await expect(page.getByText(/session is already verified/i)).toBeVisible();
  await page.goto("/app/today");

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
    await expect(page.getByRole("heading", { name: "Survey Day Mode" })).toBeVisible();

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
  const WITH_WRITTEN_BODIES = new Set(["admit", "fall", "survey-packet", "discharge"]);
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
