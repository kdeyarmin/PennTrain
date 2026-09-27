import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createSignupOrganizationHandler } from "./handler.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  TURNSTILE_SECRET_KEY: "test-turnstile-secret",
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "admin@example.test", first_name: "Facility", last_name: "Administrator",
    organization_name: "New licensed facility", facility_type: "PCH", product: "carebase",
    legal_accepted: true, turnstile_token: "proof",
    service_agreement_version: "CareMetric-Facility-Admin-Service-Agreement-v2026-07-14",
    baa_version: "CareMetric-HIPAA-BAA-v2026-07-14", ...overrides,
  };
}

function request(body: unknown) {
  return new Request("https://project.test/functions/v1/signup-organization", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function setup(options: { turnstileSuccess?: boolean; profileError?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const invitations: unknown[] = [];
  const deletedUsers: string[] = [];
  let clientsCreated = 0;
  let turnstileRequests = 0;
  const admin = {
    from(table: string) {
      assertEquals(table, "platform_settings");
      let key = "";
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => { key = value; return query; },
        maybeSingle: () => Promise.resolve({ data: { value: key === "signup_enabled" ? true : 30 }, error: null }),
      };
      return query;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: name === "record_organization_signup" ? ORGANIZATION_ID : name === "reserve_signup_attempt" ? "attempt-id" : null,
        error: name === "admin_update_profile" && options.profileError ? { message: "Profile update failed" } : null,
      });
    },
    auth: { admin: {
      inviteUserByEmail: (email: string, options: unknown) => {
        invitations.push({ email, options });
        return Promise.resolve({ data: { user: { id: USER_ID, email } }, error: null });
      },
      updateUserById: () => Promise.resolve({ error: null }),
      deleteUser: (id: string) => { deletedUsers.push(id); return Promise.resolve({ error: null }); },
    } },
  };
  const handler = createSignupOrganizationHandler({
    createClient: () => { clientsCreated++; return admin; },
    getEnv: name => ENV[name],
    fetchImpl: () => { turnstileRequests++; return Promise.resolve(Response.json({ success: options.turnstileSuccess !== false })); },
  });
  return { handler, calls, invitations, deletedUsers, counts: () => ({ clientsCreated, turnstileRequests }) };
}

for (const facilityType of [undefined, null, "", "ALF", "NH", "PCH,ALR", "pch", 2600, ["PCH"], { type: "PCH" }]) {
  Deno.test(`signup refuses omitted or unsupported license type ${JSON.stringify(facilityType)}`, async () => {
    const h = setup();
    const response = await h.handler(request(validBody({ facility_type: facilityType })));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "Select Personal Care Home (PCH) or Assisted Living Facility (ALF)" });
    assertEquals(h.calls, []);
    assertEquals(h.invitations, []);
    assertEquals(h.counts(), { clientsCreated: 0, turnstileRequests: 0 });
  });
}

for (const facilityType of ["PCH", "ALR"]) {
  for (const product of ["carebase", "train"]) {
    Deno.test(`${product} signup provisions the explicitly selected ${facilityType} chapter without replacing it`, async () => {
      const h = setup();
      const response = await h.handler(request(validBody({ facility_type: facilityType, product })));
      assertEquals(response.status, 200);
      assertEquals(h.calls.filter(call => call.name === "record_organization_signup").map(call => ({ name: call.args.p_name, type: call.args.p_facility_type })), [
        { name: "New licensed facility", type: facilityType },
      ]);
      assertEquals(h.calls.filter(call => call.name === "configure_train_signup").length, product === "train" ? 1 : 0);
      assertEquals(h.invitations.length, 1);
      assertEquals(h.calls.at(-1), { name: "finalize_signup_attempt", args: { p_attempt_id: "attempt-id", p_success: true, p_error_code: null } });
    });
  }
}

Deno.test("selecting a license type still requires signup verification before provisioning", async () => {
  const h = setup({ turnstileSuccess: false });
  assertEquals((await h.handler(request(validBody()))).status, 400);
  assertEquals(h.calls, []);
  assertEquals(h.invitations, []);
});

Deno.test("signup failure rolls back the organization and its new facility before deleting the invite", async () => {
  const h = setup({ profileError: true });
  assertEquals((await h.handler(request(validBody({ facility_type: "ALR" })))).status, 500);
  assertEquals(h.calls.find(call => call.name === "rollback_organization_signup"), {
    name: "rollback_organization_signup", args: { p_organization_id: ORGANIZATION_ID },
  });
  assertEquals(h.deletedUsers, [USER_ID]);
  assertEquals(h.calls.at(-1)?.args.p_success, false);
});
