/**
 * Live-run the identity/user Edge Function handlers against a local Supabase stack.
 *
 * Not picked up by `check:edge-functions` (not under supabase/functions as *.test.ts).
 * Requires the local API and its keys from `supabase status -o env` -- do not hard-code
 * those JWTs; they trip secret-scan and would privilege whatever URL is targeted.
 *
 *   eval "$(npx --yes supabase@2.109.1 status -o env)"
 *   deno run --allow-net --allow-env --node-modules-dir=auto scripts/validate-user-functions.ts
 *
 * Accepts either the Edge Function names (`SUPABASE_ANON_KEY`) or the CLI's
 * `status -o env` names (`ANON_KEY`, `SERVICE_ROLE_KEY`, `API_URL`).
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.48.1";
import { createCreateUserHandler } from "../supabase/functions/create-user/handler.ts";
import { createInviteUserHandler } from "../supabase/functions/invite-user/handler.ts";
import { createAdminUpdateUserHandler } from "../supabase/functions/admin-update-user/handler.ts";
import { createImpersonateUserHandler } from "../supabase/functions/impersonate-user/handler.ts";

const PASSWORD = "user-fn-live-1";

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(
    `${names.join(" or ")} is required. From a running local stack: eval "$(npx --yes supabase@2.109.1 status -o env)"`,
  );
}

async function totpCode(secret: string): Promise<string> {
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
  const counter = new Uint8Array(8);
  const view = new DataView(counter.buffer);
  view.setBigUint64(0, BigInt(Math.floor(Date.now() / 30_000)));
  const imported = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", imported, counter));
  const offset = digest[digest.length - 1] & 0x0f;
  const bin = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

let failed = 0;
function pass(name: string) {
  console.log(`PASS  ${name}`);
}
function fail(name: string, detail: unknown) {
  failed += 1;
  console.error(`FAIL  ${name}: ${detail instanceof Error ? detail.message : String(detail)}`);
}
async function expectStatus(
  name: string,
  response: Response,
  status: number,
  extra?: (body: Record<string, unknown>) => void,
) {
  const body = await response.json() as Record<string, unknown>;
  if (response.status !== status) {
    fail(name, `expected ${status}, got ${response.status} ${JSON.stringify(body)}`);
    return body;
  }
  try {
    extra?.(body);
    pass(name);
  } catch (error) {
    fail(name, error);
  }
  return body;
}

function post(handler: (req: Request) => Promise<Response>, token: string, body: unknown) {
  return handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function enrollAal2(client: SupabaseClient) {
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `user-fn-live ${Date.now()}`,
  });
  if (error || !data) throw error ?? new Error("MFA enroll returned nothing");
  const code = await totpCode(data.totp.secret);
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code,
  });
  if (verifyError) throw verifyError;
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session.session) {
    throw sessionError ?? new Error("MFA verify returned no session");
  }
  return session.session.access_token;
}

async function createLogin(
  admin: SupabaseClient,
  opts: { email: string; role: string; organizationId?: string | null },
) {
  const appMetadata: Record<string, string> = { role: opts.role };
  if (opts.organizationId) appMetadata.organization_id = opts.organizationId;
  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: { first_name: "Live", last_name: opts.role },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const { error: profileError } = await admin.rpc("admin_update_profile", {
    p_user_id: data.user.id,
    p_role: opts.role,
    p_is_active: true,
    ...(opts.organizationId ? { p_organization_id: opts.organizationId } : {}),
  });
  if (profileError) throw profileError;
  return data.user.id;
}

async function signInWithMfa(email: string, supabaseUrl: string, anonKey: string) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error("sign-in returned no session");
  const token = await enrollAal2(client);
  return { client, token };
}

async function main() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_URL") ?? "http://127.0.0.1:54321";
  const anonKey = requireEnv("SUPABASE_ANON_KEY", "ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");
  const getEnv = (name: string) =>
    ({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      PUBLIC_APP_URL: "https://cmcarebase.com",
    } as Record<string, string>)[name];

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = String(Date.now());
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .insert({
      name: `User Functions ${suffix}`,
      slug: `user-functions-${suffix}`,
      subscription_status: "active",
    })
    .select("id")
    .single();
  if (organizationError) throw organizationError;
  const organizationId = organization.id as string;

  const { data: demoOrg, error: demoOrgError } = await admin
    .from("organizations")
    .insert({
      name: `User Functions Demo ${suffix}`,
      slug: `user-functions-demo-${suffix}`,
      subscription_status: "active",
      is_demo: true,
      demo_seed_version: 1,
    })
    .select("id")
    .single();
  if (demoOrgError) throw demoOrgError;

  const { data: facility, error: facilityError } = await admin.from("facilities").insert({
    organization_id: organizationId,
    name: "User Functions Facility",
    facility_type: "PCH",
  }).select("id").single();
  if (facilityError) throw facilityError;
  const facilityId = facility.id as string;

  const orgAdminEmail = `org-admin-${suffix}@test.local`;
  const platformEmail = `platform-${suffix}@test.local`;
  const trainerEmail = `trainer-created-${suffix}@test.local`;
  const invitedEmail = `invited-mgr-${suffix}@test.local`;
  const employeeEmail = `employee-${suffix}@test.local`;

  const orgAdminId = await createLogin(admin, { email: orgAdminEmail, role: "org_admin", organizationId });
  const platformId = await createLogin(admin, { email: platformEmail, role: "platform_admin" });
  const otherPlatformEmail = `platform-b-${suffix}@test.local`;
  const otherPlatformId = await createLogin(admin, { email: otherPlatformEmail, role: "platform_admin" });
  const { error: assignmentError } = await admin.from("facility_assignments").insert({
    profile_id: orgAdminId,
    facility_id: facilityId,
  });
  if (assignmentError) throw assignmentError;
  const { client: orgAdminClient, token: orgAdminToken } = await signInWithMfa(
    orgAdminEmail,
    supabaseUrl,
    anonKey,
  );
  const { token: platformToken } = await signInWithMfa(platformEmail, supabaseUrl, anonKey);

  const createUser = createCreateUserHandler({ createClient, getEnv });
  const inviteUser = createInviteUserHandler({ createClient, getEnv });
  const adminUpdateUser = createAdminUpdateUserHandler({ createClient, getEnv });
  const impersonateUser = createImpersonateUserHandler({ createClient, getEnv });

  const created = await expectStatus(
    "create-user: org_admin creates a trainer",
    await post(createUser, orgAdminToken, {
      email: trainerEmail,
      password: PASSWORD,
      first_name: "Created",
      last_name: "Trainer",
      role: "trainer",
      organization_id: organizationId,
    }),
    200,
    (body) => {
      if (body.success !== true) throw new Error("missing success");
    },
  );
  const trainerId = (created.user as { id: string } | undefined)?.id;
  if (!trainerId) {
    fail("create-user returned no user id", created);
  } else {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("role, organization_id, first_name, last_name, is_active")
      .eq("id", trainerId)
      .single();
    if (error) fail("create-user profile lookup", error);
    else if (
      profile.role !== "trainer" ||
      profile.organization_id !== organizationId ||
      profile.first_name !== "Created" ||
      profile.is_active !== true
    ) {
      fail("create-user handle_new_user projection", JSON.stringify(profile));
    } else {
      pass("create-user: handle_new_user wrote role/org from app_metadata");
    }
  }

  await expectStatus(
    "create-user: org_admin cannot create platform_admin",
    await post(createUser, orgAdminToken, {
      email: `blocked-pa-${suffix}@test.local`,
      password: PASSWORD,
      first_name: "No",
      last_name: "Admin",
      role: "platform_admin",
      organization_id: organizationId,
    }),
    403,
  );

  await expectStatus(
    "create-user: platform_admin cannot provision into a demo tenant",
    await post(createUser, platformToken, {
      email: `demo-user-${suffix}@test.local`,
      password: PASSWORD,
      first_name: "Demo",
      last_name: "User",
      role: "org_admin",
      organization_id: demoOrg.id,
    }),
    403,
  );

  const invited = await expectStatus(
    "invite-user: org_admin invites a facility_manager",
    await post(inviteUser, orgAdminToken, {
      email: invitedEmail,
      first_name: "Invited",
      last_name: "Manager",
      role: "facility_manager",
      organization_id: organizationId,
      redirect_to: "https://cmcarebase.com/reset-password",
    }),
    200,
    (body) => {
      if (body.success !== true) throw new Error("missing success");
    },
  );
  const invitedId = (invited.user as { id: string } | undefined)?.id;
  if (invitedId) {
    const { data: invitation, error } = await admin
      .from("user_invitation_lifecycle")
      .select("status, invited_role, invited_user_id")
      .eq("invited_user_id", invitedId)
      .maybeSingle();
    if (error) fail("invite-user ledger lookup", error);
    else if (invitation?.status !== "sent" || invitation.invited_role !== "facility_manager") {
      fail("invite-user ledger row", JSON.stringify(invitation));
    } else {
      pass("invite-user: lifecycle receipt recorded as sent");
    }
    const { data: invitedProfile } = await admin
      .from("profiles")
      .select("role, organization_id, is_active")
      .eq("id", invitedId)
      .single();
    if (
      invitedProfile?.role === "facility_manager" &&
      invitedProfile.organization_id === organizationId &&
      invitedProfile.is_active === true
    ) {
      pass("invite-user: provisioned profile is the invited role and active");
    } else {
      fail("invite-user provisioned profile", JSON.stringify(invitedProfile));
    }
  }

  const { data: employee, error: employeeError } = await admin.from("employees").insert({
    organization_id: organizationId,
    facility_id: facilityId,
    first_name: "Portal",
    last_name: "Employee",
    email: employeeEmail,
    job_title: "Direct Care Worker",
    status: "active",
  }).select("id").single();
  if (employeeError) fail("seed employee for portal invite", employeeError);
  else {
    const employeeInvite = await expectStatus(
      "invite-user: employee path links employees.profile_id",
      await post(inviteUser, orgAdminToken, {
        email: employeeEmail,
        first_name: "Portal",
        last_name: "Employee",
        role: "employee",
        organization_id: organizationId,
        employee_id: employee.id,
        redirect_to: "https://cmcarebase.com/reset-password",
      }),
      200,
    );
    const linkedId = (employeeInvite.user as { id: string } | undefined)?.id;
    if (linkedId) {
      const { data: linked } = await admin
        .from("employees")
        .select("profile_id")
        .eq("id", employee.id)
        .single();
      if (linked?.profile_id === linkedId) pass("invite-user: employee row linked to the new profile");
      else fail("invite-user employee link", JSON.stringify(linked));
    }
  }

  if (trainerId) {
    await expectStatus(
      "admin-update-user: org_admin changes trainer to auditor",
      await post(adminUpdateUser, orgAdminToken, { user_id: trainerId, role: "auditor" }),
      200,
      (body) => {
        if (body.success !== true) throw new Error("missing success");
      },
    );
    await expectStatus(
      "admin-update-user: org_admin deactivates the user",
      await post(adminUpdateUser, orgAdminToken, { user_id: trainerId, is_active: false }),
      200,
    );
    const { data: deactivated } = await admin
      .from("profiles")
      .select("is_active, role")
      .eq("id", trainerId)
      .single();
    if (deactivated?.is_active === false && deactivated.role === "auditor") {
      pass("admin-update-user: profile is inactive auditor");
    } else {
      fail("admin-update-user deactivate projection", JSON.stringify(deactivated));
    }
    await expectStatus(
      "admin-update-user: org_admin cannot set another user's password",
      await post(adminUpdateUser, orgAdminToken, { user_id: trainerId, password: "hijacked1" }),
      403,
    );
    await expectStatus(
      "admin-update-user: org_admin cannot reset MFA",
      await post(adminUpdateUser, orgAdminToken, {
        action: "reset_mfa",
        user_id: trainerId,
        reason: "Lost phone, identified by facility callback",
      }),
      403,
    );
    await expectStatus(
      "admin-update-user: reactivate",
      await post(adminUpdateUser, orgAdminToken, { user_id: trainerId, is_active: true }),
      200,
    );
    await expectStatus(
      "admin-update-user: platform_admin reset_mfa on a user with no factors",
      await post(adminUpdateUser, platformToken, {
        action: "reset_mfa",
        user_id: trainerId,
        reason: "Lost phone, identified by facility callback",
      }),
      200,
      (body) => {
        if (body.success !== true) throw new Error("missing success");
      },
    );
  }

  await expectStatus(
    "impersonate-user: org_admin cannot start",
    await post(impersonateUser, orgAdminToken, {
      action: "start_bound",
      target_user_id: trainerId,
      reason: "support ticket review",
    }),
    403,
  );

  if (trainerId) {
    await expectStatus(
      "impersonate-user: stale browser must refresh before starting",
      await post(impersonateUser, platformToken, {
        action: "start",
        target_user_id: trainerId,
        reason: "stale browser support request",
      }),
      409,
      (body) => {
        if (body.code !== "client_update_required" || body.session || body.token_hash) {
          throw new Error("legacy protocol must be refused without credentials");
        }
      },
    );
    const started = await expectStatus(
      "impersonate-user: platform_admin starts a bounded session",
      await post(impersonateUser, platformToken, {
        action: "start_bound",
        target_user_id: trainerId,
        reason: "Investigating a support ticket about training",
      }),
      200,
      (body) => {
        const session = body.session as { access_token?: string; refresh_token?: string } | undefined;
        if (!session?.access_token || !session.refresh_token || !body.impersonation_id || !body.context_secret) {
          throw new Error("incomplete start payload");
        }
        if (body.token_hash) throw new Error("start must not return an unbound credential");
      },
    );
    const boundSession = started.session as { access_token?: string; refresh_token?: string } | undefined;
    if (boundSession?.access_token && boundSession.refresh_token && started.impersonation_id && started.context_secret) {
      const targetClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: sessionError } = await targetClient.auth.setSession({
        access_token: boundSession.access_token,
        refresh_token: boundSession.refresh_token,
      });
      if (sessionError) fail("impersonate-user setSession", sessionError);
      else {
        const { data: targetSession } = await targetClient.auth.getSession();
        const targetToken = targetSession.session?.access_token;
        if (!targetToken) fail("impersonate-user target session", "no access token");
        else {
          await expectStatus(
            "impersonate-user: repeated bind remains compatible for the bound Auth session",
            await post(impersonateUser, targetToken, {
              action: "bind",
              impersonation_id: started.impersonation_id,
              context_secret: started.context_secret,
            }),
            200,
          );
          await expectStatus(
            "impersonate-user: end revokes the target session",
            await post(impersonateUser, targetToken, {
              action: "end",
              impersonation_id: started.impersonation_id,
              context_secret: started.context_secret,
            }),
            200,
          );
        }
      }
    }
  }

  await expectStatus(
    "impersonate-user: cannot impersonate another platform_admin",
    await post(impersonateUser, platformToken, {
      action: "start_bound",
      target_user_id: otherPlatformId,
      reason: "should be refused",
    }),
    403,
  );

  if (invitedId) {
    await expectStatus(
      "impersonate-user: refuses an invitee who has never signed in",
      await post(impersonateUser, platformToken, {
        action: "start_bound",
        target_user_id: invitedId,
        reason: "would mark the invite accepted",
      }),
      409,
    );

    const { data: invitationRow } = await admin
      .from("user_invitation_lifecycle")
      .select("id")
      .eq("invited_user_id", invitedId)
      .maybeSingle();
    if (!invitationRow) fail("revoke_user_invitation lookup", "no ledger row");
    else {
      const { error: revokeError } = await orgAdminClient.rpc("revoke_user_invitation", {
        p_invitation_id: invitationRow.id,
        p_reason: "live validation of revoke_user_invitation",
      });
      if (revokeError) fail("revoke_user_invitation", revokeError.message);
      else pass("revoke_user_invitation: revoked the pending invite");
    }
    const { data: revokedProfile } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", invitedId)
      .single();
    if (revokedProfile?.is_active === false) pass("revoke_user_invitation: profile is deactivated");
    else fail("revoke_user_invitation profile", JSON.stringify(revokedProfile));
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    Deno.exit(1);
  }
  console.log("\nAll user-function live checks passed.");
}

main().catch((error) => {
  console.error(error);
  Deno.exit(1);
});
