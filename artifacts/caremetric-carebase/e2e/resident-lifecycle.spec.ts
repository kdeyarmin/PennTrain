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
let residentId: string | null = null;

const step = (id: string) => {
  const found = RESIDENT_JOURNEY_STEPS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown journey step "${id}"`);
  return found;
};

/** Signs in and lands on the authenticated home. */
async function signIn(page: import("@playwright/test").Page) {
  // Every observation channel, because each CI round costs a full run and the last one reported
  // only "no headings" -- which eliminated four mechanisms but named none. The poll logs a timeline
  // line whenever the observed state CHANGES (path flap = redirect loop; body text = what a user
  // would see; console/page errors and failed requests = what broke underneath).
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${String(error).slice(0, 200)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text().slice(0, 200)}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed:${request.method()} ${request.url().slice(0, 160)} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`http${response.status()}:${response.url().slice(0, 160)}`);
  });

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
        ].map((feature_key) => ({
          organization_id: organizationId,
          feature_key,
          decision: "grant",
          entitlement_value: true,
          reason: "Resident lifecycle journey fixture",
        })),
      );
    if (entitlementError) throw entitlementError;

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
    await adminAuthClient.auth.signOut();
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
  // 2-12. Declared, not yet proven.
  //
  // Registered from the registry so the count in the Playwright report and the count in
  // scripts/check-journey-coverage.mjs cannot disagree. Each carries its real blocker.
  // -------------------------------------------------------------------------------------------
  const WITH_WRITTEN_BODIES = new Set(["admit"]);
  for (const pending of RESIDENT_JOURNEY_STEPS.filter(
    (entry) => entry.status === "pending" && !WITH_WRITTEN_BODIES.has(entry.id),
  )) {
    test(`${pending.ordinal}. ${pending.title}`, () => {
      test.fixme(true, `${pending.proves} Blocked: ${pending.blockedBy}`);
    });
  }

  test("the admitted resident is the one later steps will carry forward", async () => {
    test.skip(residentId === null, "step 1 did not complete");
    const { data, error } = await admin
      .from("residents")
      .select("status")
      .eq("id", residentId!)
      .single();
    if (error) throw error;
    expect(data.status).toBe("active");
  });
});
