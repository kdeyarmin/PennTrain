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
const password = process.env.E2E_ACCOUNT_PASSWORD ?? "";

let admin: SupabaseClient;
let organizationId: string;
let facilityId: string;
let adminEmail: string;
let residentId: string | null = null;

const step = (id: string) => {
  const found = RESIDENT_JOURNEY_STEPS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown journey step "${id}"`);
  return found;
};

/** Signs in and lands on the authenticated home. */
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe("/app/today");
}

test.describe("resident lifecycle journey", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    if (!supabaseUrl || !serviceRoleKey || !password) {
      throw new Error(
        "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and E2E_ACCOUNT_PASSWORD are required for the "
        + "resident lifecycle journey",
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
  });

  // -------------------------------------------------------------------------------------------
  // 1. Admit
  // -------------------------------------------------------------------------------------------
  test(`1. ${step("admit").title} ["admit"]`, async ({ page }) => {
    await signIn(page);
    await page.goto("/app/residents");
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
  for (const pending of RESIDENT_JOURNEY_STEPS.filter((entry) => entry.status === "pending")) {
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
