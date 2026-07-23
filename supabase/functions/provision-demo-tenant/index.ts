// @ts-nocheck
// Provisions the public demo sandbox: ensures the demo organization exists, creates (or refreshes)
// the five synthetic public-demo login accounts via the Admin API, and seeds the demo data. This is
// the hosted counterpart to supabase/seed.sql's local-only demo users (see DEPLOYMENT.md ->
// "Public demo sandbox (/demo)"). It is deliberately NOT one of create-user/invite-user, which
// refuse to provision into a demo org -- provisioning demo identities is a separate ops action,
// authorized by a shared secret rather than a signed-in admin so it can run as a one-off deploy step.
//
// Idempotent: safe to re-run. Existing accounts are refreshed (password + role/org healed) rather
// than duplicated. The account password comes from DEMO_ACCOUNT_PASSWORD; the same value must be
// published to the browser build as VITE_DEMO_ACCOUNTS_JSON (the demo passwords are inherently
// public -- they ship in the bundle for the /demo one-click login), and this function returns a
// ready-to-paste VITE_DEMO_ACCOUNTS_JSON so the two never drift.
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-demo-provision-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // The success payload carries the demo password; keep every response out of shared/proxy
      // and client caches.
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

// Constant-time secret comparison. Hashing both sides to a fixed 32-byte SHA-256 digest first means
// the compare loop length never depends on the provided value, so neither the secret's contents nor
// its length can be recovered by timing the response.
async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const a = new Uint8Array(providedHash);
  const b = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

const DEMO_ORG_NAME = "Sunrise Healthcare Group";
const DEMO_ORG_SLUG = "sunrise-healthcare";

// Mirrors VITE_DEMO_ACCOUNTS_JSON in .env.example and the role assignments in supabase/seed.sql.
// Never includes platform_admin (demoAccounts.ts only allow-lists these five non-privileged roles).
const DEMO_ACCOUNTS = [
  {
    label: "Organization admin",
    email: "admin@sunrisehealthcare.com",
    first_name: "Robert",
    last_name: "Chen",
    role: "org_admin",
    description: "Explore organization setup, staffing, compliance, and reporting.",
  },
  {
    label: "Facility manager",
    email: "manager@sunrisemanor.com",
    first_name: "Morgan",
    last_name: "Lee",
    role: "facility_manager",
    description: "Manage facility operations, residents, schedules, and readiness.",
  },
  {
    label: "Trainer",
    email: "trainer@sunrisehealthcare.com",
    first_name: "Alex",
    last_name: "Rivera",
    role: "trainer",
    description: "Explore the course catalog, classes, assignments, and credentials.",
  },
  {
    label: "Employee",
    email: "employee@sunrisehealthcare.com",
    first_name: "Jamie",
    last_name: "Okafor",
    role: "employee",
    description: "See assigned learning, due dates, and personal credentials.",
  },
  {
    label: "Auditor",
    email: "auditor@sunrisehealthcare.com",
    first_name: "Sam",
    last_name: "Martinez",
    role: "auditor",
    description: "Review compliance status, reports, and supporting records.",
  },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const provisionSecret = Deno.env.get("DEMO_PROVISION_SECRET");
  const password = Deno.env.get("DEMO_ACCOUNT_PASSWORD");
  if (!provisionSecret || !password) {
    return json(
      { error: "Demo provisioning is not configured (set DEMO_PROVISION_SECRET and DEMO_ACCOUNT_PASSWORD)." },
      503,
    );
  }
  const provided = req.headers.get("x-demo-provision-secret") ?? "";
  if (!(await secretsMatch(provided, provisionSecret))) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (password.length < 8) {
    return json({ error: "DEMO_ACCOUNT_PASSWORD must be at least 8 characters." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient<any>(supabaseUrl, serviceRoleKey);

  // 1. Ensure the demo organization exists (idempotent on slug). The check constraint requires
  //    demo_seed_version > 0 whenever is_demo is true.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .upsert(
      { name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, is_demo: true, demo_seed_version: 1 },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (orgError || !org) {
    return json({ error: `Could not ensure demo organization: ${orgError?.message ?? "unknown error"}` }, 500);
  }
  const organizationId = org.id as string;

  // 2. Create or refresh each synthetic account. role/organization_id go in app_metadata so the
  //    handle_new_user() trigger stamps them onto the profile on insert (a client can never set them).
  const accounts: Array<{ email: string; role: string; status: string; error?: string }> = [];
  for (const account of DEMO_ACCOUNTS) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { first_name: account.first_name, last_name: account.last_name },
      app_metadata: { role: account.role, organization_id: organizationId },
    });

    if (!createError && created?.user) {
      accounts.push({ email: account.email, role: account.role, status: "created" });
      continue;
    }

    // Already registered -> refresh in place. profiles.id == auth.users.id, so look the account up
    // by email (service-role bypasses RLS), rotate its password/app_metadata, and heal the profile's
    // role/org (the insert trigger is ON CONFLICT DO NOTHING and won't re-run for an existing user).
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", account.email)
      .maybeSingle();
    if (!existing?.id) {
      accounts.push({
        email: account.email,
        role: account.role,
        status: "error",
        error: createError?.message ?? "account exists but its profile was not found",
      });
      continue;
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata: { role: account.role, organization_id: organizationId },
    });
    const { error: healError } = await admin.rpc("admin_update_profile", {
      p_user_id: existing.id,
      p_role: account.role,
      p_organization_id: organizationId,
      // Reactivate: a previously deactivated demo profile is signed straight back out by
      // AuthProvider, so the refreshed credentials would otherwise be unable to enter /demo.
      p_is_active: true,
    });
    accounts.push({
      email: account.email,
      role: account.role,
      status: updateError || healError ? "error" : "refreshed",
      ...(updateError || healError
        ? { error: (updateError?.message ?? healError?.message) as string }
        : {}),
    });
  }

  // 3. Seed the demo data now so /demo isn't empty until the daily reseed cron runs. Best-effort:
  //    sign in as the just-provisioned org_admin and call the public restore_demo_baseline() RPC
  //    (which requires an org_admin session in a demo org). Failure here never fails provisioning --
  //    the seed_demo_organization migration and the daily restore-all cron also populate the tenant.
  let seed = "skipped";
  try {
    const orgAdmin = DEMO_ACCOUNTS.find((account) => account.role === "org_admin")!;
    const userClient = createClient<any>(supabaseUrl, anonKey);
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: orgAdmin.email,
      password,
    });
    if (signInError) {
      seed = `sign-in failed: ${signInError.message}`;
    } else {
      const { error: seedError } = await userClient.rpc("restore_demo_baseline");
      seed = seedError ? `error: ${seedError.message}` : "seeded";
      await userClient.auth.signOut();
    }
  } catch (error) {
    seed = `error: ${error instanceof Error ? error.message : "unknown"}`;
  }

  // 3b. Link the facility-scoped demo roles so their /demo workspaces aren't empty under RLS.
  //     seed_demo_organization seeds operational data but not these per-profile links: the
  //     facility_manager/trainer need facility_assignments and the manager/trainer/employee need
  //     an employees row (mirrors supabase/seed.sql). org_admin/auditor are org-wide and need
  //     neither. Best-effort and idempotent (check-then-insert) -- never fails provisioning.
  let links = "skipped";
  try {
    const nameOf = (email: string) => DEMO_ACCOUNTS.find((a) => a.email === email)!;
    const { data: facilities } = await admin
      .from("facilities")
      .select("id, name")
      .eq("organization_id", organizationId);
    const facilityId = (name: string) => facilities?.find((f) => f.name === name)?.id ?? null;
    const manor = facilityId("Sunrise Manor");
    const gardens = facilityId("Sunrise Gardens");

    const profileId = async (email: string) => {
      const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      return (data?.id as string | undefined) ?? null;
    };
    const managerId = await profileId("manager@sunrisemanor.com");
    const trainerId = await profileId("trainer@sunrisehealthcare.com");
    const employeeId = await profileId("employee@sunrisehealthcare.com");

    if (!manor) {
      links = "no demo facilities yet (re-run after the tenant is seeded)";
    } else {
      const assignments = [
        managerId ? { profile_id: managerId, facility_id: manor } : null,
        trainerId ? { profile_id: trainerId, facility_id: manor } : null,
        trainerId && gardens ? { profile_id: trainerId, facility_id: gardens } : null,
      ].filter(Boolean) as Array<{ profile_id: string; facility_id: string }>;
      for (const assignment of assignments) {
        const { data: existing } = await admin
          .from("facility_assignments")
          .select("profile_id")
          .eq("profile_id", assignment.profile_id)
          .eq("facility_id", assignment.facility_id)
          .maybeSingle();
        if (!existing) await admin.from("facility_assignments").insert(assignment);
      }

      const employeeRows = [
        managerId
          ? { profile_id: managerId, email: "manager@sunrisemanor.com", job_title: "Facility Administrator", hire_date: "2023-03-01", extra: {} }
          : null,
        trainerId
          ? { profile_id: trainerId, email: "trainer@sunrisehealthcare.com", job_title: "Staff Trainer", hire_date: "2022-08-15", extra: { trainer_status: true } }
          : null,
        employeeId
          ? { profile_id: employeeId, email: "employee@sunrisehealthcare.com", job_title: "Direct Care Staff", hire_date: "2026-02-12", extra: { administers_medications: true } }
          : null,
      ].filter(Boolean) as Array<{ profile_id: string; email: string; job_title: string; hire_date: string; extra: Record<string, unknown> }>;
      for (const row of employeeRows) {
        const { data: existing } = await admin
          .from("employees")
          .select("id")
          .eq("profile_id", row.profile_id)
          .maybeSingle();
        if (!existing) {
          const account = nameOf(row.email);
          await admin.from("employees").insert({
            organization_id: organizationId,
            facility_id: manor,
            profile_id: row.profile_id,
            first_name: account.first_name,
            last_name: account.last_name,
            email: row.email,
            job_title: row.job_title,
            hire_date: row.hire_date,
            status: "active",
            is_synthetic: true,
            ...row.extra,
          });
        }
      }
      links = "linked";
    }
  } catch (error) {
    links = `error: ${error instanceof Error ? error.message : "unknown"}`;
  }

  // 4. Return the exact VITE_DEMO_ACCOUNTS_JSON to publish to the browser build, so the login
  //    buttons and these accounts can never drift.
  const viteDemoAccountsJson = JSON.stringify(
    DEMO_ACCOUNTS.map((account) => ({
      label: account.label,
      email: account.email,
      password,
      role: account.role,
      description: account.description,
    })),
  );

  return json({
    success: true,
    organization_id: organizationId,
    accounts,
    seed,
    links,
    viteDemoAccountsJson,
  });
});
