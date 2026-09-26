import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { createInviteUserHandler } from "./handler.ts";
import type { DelegatedInviteAuthority } from "./handler.ts";

// Re-inviting someone whose invitation was revoked produced a permanently deactivated account:
// revoke_user_invitation sets profiles.is_active = false, and GoTrue re-invites an unconfirmed
// address by REUSING the same auth user, so there is no auth.users INSERT, handle_new_user never
// runs again, and nothing else on this path turned is_active back on. The invitee set a password
// and was told "Your account has been deactivated." These tests pin the reactivation onto both
// provisioning paths -- including the employee one, whose RPC has no p_is_active parameter to
// carry it.

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  PUBLIC_APP_URL: "https://cmcarebase.com",
};
const getEnv = (name: string) => ENV[name];

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_ORG_ID = "66666666-6666-4666-8666-666666666666";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const INVITED_ID = "44444444-4444-4444-8444-444444444444";
const EMPLOYEE_ID = "55555555-5555-4555-8555-555555555555";
const EMAIL = "returning@example.test";

function makeRequest(body: unknown): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

for (const body of [null, [], true, { note: "x".repeat(16_384) }]) {
  Deno.test(`invite-user rejects malformed or oversized JSON ${typeof body}`, async () => {
    const { handler, rpcCalls } = makeHandler();
    const response = await handler(makeRequest(body));
    assertEquals(response.status, body && typeof body === "object" && "note" in body ? 413 : 400);
    assertEquals(rpcCalls, []);
  });
}

function chainable(result: { data: unknown; error: unknown }) {
  // deno-lint-ignore no-explicit-any
  const obj: any = {};
  const self = () => obj;
  for (const method of ["select", "eq", "ilike", "limit", "update"]) obj[method] = self;
  obj.single = async () => result;
  obj.maybeSingle = async () => result;
  obj.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return obj;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function makeHandler(opts: {
  employeeMatches?: unknown[];
  callerRole?: string;
  callerOrgId?: string | null;
  demoOrgIds?: string[];
  delegatedAuthority?: DelegatedInviteAuthority;
  assuranceAllowed?: boolean;
  inviteError?: { code: string; status: number; message: string };
  inviteThrows?: boolean;
  brandingName?: string;
  facilityName?: string;
  trainingEnabled?: boolean;
  invitationBranding?: { logo_path?: string; contact_name?: string; contact_email?: string };
  logoFails?: boolean;
  logoThrows?: boolean;
  existingProfiles?: { id: string; email: string; organization_id: string | null }[];
  existingIdentity?: { id: string; email: string; invited_at?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null };
  profileLookupError?: boolean;
  identityLookupError?: boolean;
  metadataRefreshError?: boolean;
  metadataRefreshThrows?: boolean;
} = {}) {
  const rpcCalls: RpcCall[] = [];
  const observations = { invites: 0, deletes: 0, authLookups: 0, assuranceChecks: 0, employeeFilters: [] as [string,unknown][], inviteOptions: {} as Record<string, unknown>, brandingFilters: [] as [string, unknown][], brandingArgs: undefined as Record<string, unknown> | undefined, signedLogos: [] as [string, string, number][] };
  const resend = { filters: [] as [string, unknown][], identityIds: [] as string[], updates: [] as { id: string; attributes: Record<string, unknown> }[], events: [] as string[] };
  const demoOrgIds = new Set(opts.demoOrgIds ?? []);
  const callerRole = opts.callerRole ?? "org_admin";
  const callerOrgId = opts.callerOrgId === undefined ? ORG_ID : opts.callerOrgId;

  const callerClient = {
    auth: { getUser: async () => { observations.authLookups++; return { data: { user: { id: CALLER_ID } }, error: null }; } },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: { role: callerRole, organization_id: callerOrgId, is_active: true },
          error: null,
        });
      }
      if (table === "organizations") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => ({
                data: { is_demo: demoOrgIds.has(value), name: opts.brandingName },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "employees") {
        const query=chainable({ data: opts.employeeMatches ?? [], error: null });
        query.eq=(column:string,value:unknown)=>{observations.employeeFilters.push([column,value]);return query;};
        return query;
      }
      if (table === "facilities") {
        const query = chainable({ data: { name: opts.facilityName }, error: null });
        query.eq = (column: string, value: unknown) => { observations.brandingFilters.push([column,value]); return query; };
        return query;
      }
      throw new Error(`unexpected caller table: ${table}`);
    },
    rpc: async (name: string) => {
      if (name === "get_effective_entitlements") return { data: [{ feature_key: "modules.train", is_entitled: opts.trainingEnabled ?? true }], error: null };
      observations.assuranceChecks++; return { data: opts.assuranceAllowed ?? true, error: null };
    },
  };

  const adminClient = {
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, seconds: number) => {
      observations.signedLogos.push([bucket, path, seconds]);
      if (opts.logoThrows) throw new Error("Storage unavailable");
      return opts.logoFails ? { data: null, error: { message: "Logo unavailable" } }
        : { data: { signedUrl: `${ENV.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}?token=display-token` }, error: null };
    } }) },
    auth: {
      admin: {
        inviteUserByEmail: async (_email: string, options: Record<string, unknown>) => { resend.events.push("send"); observations.invites++; observations.inviteOptions = options; if(opts.inviteThrows)throw new Error("provider timeout"); return { data: { user: { id: INVITED_ID, email: EMAIL } }, error: opts.inviteError ?? null }; },
        deleteUser: async () => { observations.deletes++; return { data: null, error: null }; },
        getUserById: async (id: string) => { resend.identityIds.push(id); return { data: { user: opts.existingIdentity ?? { id: INVITED_ID, email: EMAIL, invited_at: "2026-01-01T00:00:00Z", email_confirmed_at: null } }, error: opts.identityLookupError ? new Error("Lookup failed") : null }; },
        updateUserById: async (id: string, attributes: Record<string, unknown>) => {
          resend.events.push("refresh"); resend.updates.push({ id, attributes });
          if (opts.metadataRefreshThrows) throw new Error("Metadata update interrupted");
          return { data: null, error: opts.metadataRefreshError ? new Error("Metadata update failed") : null };
        },
      },
    },
    from: (table: string) => {
      if (table !== "profiles") return chainable({ data: null, error: null });
      const query = chainable({ data: opts.existingProfiles ?? [], error: opts.profileLookupError ? new Error("Lookup failed") : null });
      for (const method of ["ilike", "limit"]) query[method] = (column: string, value?: unknown) => { resend.filters.push([method, value === undefined ? column : [column, value]]); return query; };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "get_training_invitation_branding") { observations.brandingArgs = args; return { data: opts.invitationBranding ?? null, error: null }; }
      rpcCalls.push({ name, args });
      if (name === "record_user_invitation_sent") return { data: "invitation-1", error: null };
      return { data: { id: INVITED_ID, is_active: true }, error: null };
    },
  };

  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1 ? callerClient : adminClient;
  };
  return { handler: createInviteUserHandler({ createClient, getEnv,
    ...(opts.delegatedAuthority ? { resolveDelegatedAuthority: async () => opts.delegatedAuthority! } : {}) }), rpcCalls, observations, resend };
}

Deno.test("invite-user reactivates the profile when provisioning a non-employee invite", async () => {
  const { handler, rpcCalls } = makeHandler();

  const response = await handler(makeRequest({
    email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "facility_manager",
    organization_id: ORG_ID,
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  const provision = rpcCalls.find((call) => call.name === "admin_update_profile");
  assertEquals(provision?.args.p_is_active, true, "a re-invited profile must come back active");
  assertEquals(provision?.args.p_role, "facility_manager");
});

Deno.test("invite-user builds learner welcome copy from authorized facility scope, ignoring supplied branding", async () => {
  const facilityId = "77777777-7777-4777-8777-777777777777";
  const { handler, observations } = makeHandler({ brandingName: "Care Group", facilityName: "Cedar House", employeeMatches: [{ id: EMPLOYEE_ID, profile_id: null, email: EMAIL, facility_id: facilityId }] });
  const response = await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "employee", organization_id: ORG_ID,
    employee_id: EMPLOYEE_ID, invitation_workspace_name: "Spoofed facility", invitation_audience: "administrator" }));
  assertEquals(response.status, 200);
  assertEquals(observations.inviteOptions.data, { first_name: "Rae", last_name: "Nolan", invitation_workspace_name: "Cedar House", invitation_audience: "learner" });
  assertEquals(observations.brandingFilters, [["id",facilityId],["organization_id",ORG_ID]]);
});

Deno.test("invite-user uses organization welcome and a generic fallback for customers without Training", async () => {
  const { handler, observations } = makeHandler({ brandingName: "Care Group", trainingEnabled: false });
  const response = await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID }));
  assertEquals(response.status, 200);
  assertEquals(observations.inviteOptions.data, { first_name: "Rae", last_name: "Nolan", invitation_workspace_name: "Care Group", invitation_audience: "workspace" });
});

Deno.test("learner invitation signs only the authorized organization logo and uses saved facility contact", async () => {
  const facilityId = "77777777-7777-4777-8777-777777777777";
  const { handler, observations } = makeHandler({ invitationBranding: { logo_path: `${ORG_ID}/logo.png`, contact_name: "Education Team", contact_email: "training@example.test" },
    employeeMatches: [{ id: EMPLOYEE_ID, profile_id: null, email: EMAIL, facility_id: facilityId }] });
  const response = await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "employee", organization_id: ORG_ID, employee_id: EMPLOYEE_ID,
    invitation_logo_url: "https://untrusted.test/logo.png", invitation_contact_email: "spoof@example.test" }));
  assertEquals(response.status, 200);
  assertEquals(observations.brandingArgs, { p_organization_id: ORG_ID, p_facility_id: facilityId });
  assertEquals(observations.signedLogos, [["org-branding", `${ORG_ID}/logo.png`, 3600]]);
  assertEquals(observations.inviteOptions.data, { first_name: "Rae", last_name: "Nolan", invitation_audience: "learner",
    invitation_logo_url: `${ENV.SUPABASE_URL}/storage/v1/object/sign/org-branding/${ORG_ID}/logo.png?token=display-token`,
    invitation_contact_name: "Education Team", invitation_contact_email: "training@example.test" });
});

Deno.test("a cross-organization logo reference is never signed", async () => {
  const { handler, observations } = makeHandler({ invitationBranding: { logo_path: `${DEMO_ORG_ID}/logo.png` } });
  const response = await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID }));
  assertEquals(response.status, 200); assertEquals(observations.signedLogos, []);
  assertEquals((observations.inviteOptions.data as Record<string, unknown>).invitation_logo_url, undefined);
});

Deno.test("an unavailable logo leaves the saved contact and activation invitation usable", async () => {
  const { handler, observations } = makeHandler({ invitationBranding: { logo_path: `${ORG_ID}/logo.png`, contact_name: "Training coordinator" }, logoFails: true });
  const response = await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID }));
  assertEquals(response.status, 200);
  assertEquals(observations.inviteOptions.data, { first_name: "Rae", last_name: "Nolan", invitation_audience: "administrator", invitation_contact_name: "Training coordinator" });
});

for (const suffix of ["%2e%2e/other/logo.png", ".%2e/other/logo.png", "folder\\..\\..\\other/logo.png", "../other/logo.png", "./logo.png", "folder//logo.png", "logo.png?token=spoof", "logo.png#fragment", "logo.png\n", "logo image.png", "logo.png/"]) {
  Deno.test(`invitation refuses noncanonical logo object key ${JSON.stringify(suffix)}`, async () => {
    const { handler, observations } = makeHandler({ invitationBranding: { logo_path: `${ORG_ID}/${suffix}` } });
    const response = await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID }));
    assertEquals(response.status, 200); assertEquals(observations.signedLogos, []);
    assertEquals((observations.inviteOptions.data as Record<string, unknown>).invitation_logo_url, undefined);
  });
}

Deno.test("a thrown optional storage failure still sends the invitation with its contact", async () => {
  const { handler, observations } = makeHandler({ logoThrows: true, invitationBranding: { logo_path: `${ORG_ID}/logo.png`, contact_name: "Education Team" } });
  assertEquals((await handler(makeRequest({ email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID }))).status, 200);
  assertEquals((observations.inviteOptions.data as Record<string, unknown>).invitation_contact_name, "Education Team");
  assertEquals(observations.invites, 1);
});

const returningProfile = { id: INVITED_ID, email: EMAIL, organization_id: ORG_ID };
const returningBody = { email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID };
Deno.test("resend refreshes only current invitation presentation before dispatch", async () => {
  const { handler, observations, resend } = makeHandler({ existingProfiles: [returningProfile], brandingName: "Current facility group",
    invitationBranding: { logo_path: `${ORG_ID}/brand-assets/logo_v2.png`, contact_name: "Current coordinator", contact_email: "current@example.test" } });
  assertEquals((await handler(makeRequest(returningBody))).status, 200);
  assertEquals(resend.filters, [["ilike", ["email", EMAIL]], ["limit", 2]]);
  assertEquals(resend.identityIds, [INVITED_ID]);
  assertEquals(resend.updates, [{ id: INVITED_ID, attributes: { user_metadata: {
    invitation_workspace_name: "Current facility group", invitation_logo_url: `${ENV.SUPABASE_URL}/storage/v1/object/sign/org-branding/${ORG_ID}/brand-assets/logo_v2.png?token=display-token`,
    invitation_contact_name: "Current coordinator", invitation_contact_email: "current@example.test", invitation_audience: "administrator",
  } } }]);
  assertEquals(resend.events, ["refresh", "send"]); assertEquals(observations.invites, 1);
});

Deno.test("resend explicitly clears stale optional branding when current branding is unavailable", async () => {
  const { handler, resend } = makeHandler({ existingProfiles: [returningProfile], logoFails: true, invitationBranding: { logo_path: `${ORG_ID}/logo.png` } });
  assertEquals((await handler(makeRequest(returningBody))).status, 200);
  assertEquals(resend.updates[0].attributes, { user_metadata: { invitation_workspace_name: null, invitation_logo_url: null,
    invitation_contact_name: null, invitation_contact_email: null, invitation_audience: "administrator" } });
});

Deno.test("resend lookup treats email wildcard characters literally and verifies normalized Auth email", async () => {
  const email = "first_%last@example.test";
  const { handler, resend } = makeHandler({ existingProfiles: [{ ...returningProfile, email: email.toUpperCase() }],
    existingIdentity: { id: INVITED_ID, email, invited_at: "2026-01-01T00:00:00Z" } });
  assertEquals((await handler(makeRequest({ ...returningBody, email }))).status, 200);
  assertEquals(resend.filters, [["ilike", ["email", "first\\_\\%last@example.test"]], ["limit", 2]]);
});

for (const existingProfiles of [[{ ...returningProfile, organization_id: DEMO_ORG_ID }], [returningProfile, { ...returningProfile, id: CALLER_ID }]]) {
  Deno.test(`resend refuses ${existingProfiles.length > 1 ? "ambiguous" : "another organization's"} existing identity before Auth access`, async () => {
    const { handler, observations, resend } = makeHandler({ existingProfiles });
    assertEquals((await handler(makeRequest(returningBody))).status, 409);
    assertEquals(resend.identityIds, []); assertEquals(resend.updates, []); assertEquals(observations.invites, 0);
  });
}

for (const identity of [
  { id: INVITED_ID, email: EMAIL, invited_at: "2026-01-01T00:00:00Z", email_confirmed_at: "2026-01-02T00:00:00Z" },
  { id: INVITED_ID, email: EMAIL, invited_at: null },
  { id: INVITED_ID, email: "someone-else@example.test", invited_at: "2026-01-01T00:00:00Z" },
  { id: CALLER_ID, email: EMAIL, invited_at: "2026-01-01T00:00:00Z" },
]) {
  Deno.test(`resend never changes a confirmed, noninvited, or mismatched Auth identity ${JSON.stringify(identity)}`, async () => {
    const { handler, observations, resend } = makeHandler({ existingProfiles: [returningProfile], existingIdentity: identity });
    const response = await handler(makeRequest(returningBody));
    assertEquals(response.status >= 400, true); assertEquals(resend.updates, []); assertEquals(observations.invites, 0);
  });
}

for (const failure of ["profileLookupError", "identityLookupError", "metadataRefreshError", "metadataRefreshThrows"] as const) {
  Deno.test(`resend uncertainty ${failure} cannot send stale details or delete an existing account`, async () => {
    const { handler, observations } = makeHandler({ existingProfiles: [returningProfile], [failure]: true });
    assertEquals((await handler(makeRequest(returningBody))).status, 500);
    assertEquals(observations.invites, 0); assertEquals(observations.deletes, 0);
  });
}

Deno.test("invite-user reactivates on the employee path too, whose RPC cannot carry it", async () => {
  const { handler, rpcCalls } = makeHandler({
    employeeMatches: [{ id: EMPLOYEE_ID, profile_id: null, email: EMAIL }],
  });

  const response = await handler(makeRequest({
    email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "employee",
    organization_id: ORG_ID, employee_id: EMPLOYEE_ID,
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  // provision_invited_employee_profile is (uuid, uuid, uuid) -- reactivation is a separate call to
  // the same trusted RPC, and it has to happen before provisioning so the compensating delete
  // still covers a failure.
  assertEquals(
    rpcCalls.map((call) => call.name),
    ["admin_update_profile", "provision_invited_employee_profile", "record_user_invitation_sent"],
  );
  assertEquals(rpcCalls[0].args.p_is_active, true);
  assertEquals(rpcCalls[1].args.p_employee_id, EMPLOYEE_ID);
});

Deno.test("invite-user does not provision when the employee already has portal access", async () => {
  const { handler, rpcCalls } = makeHandler({
    employeeMatches: [{ id: EMPLOYEE_ID, profile_id: "someone-else", email: EMAIL }],
  });

  const response = await handler(makeRequest({
    email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "employee",
    organization_id: ORG_ID, employee_id: EMPLOYEE_ID,
  }));

  assertEquals(response.status, 409);
  assertEquals(rpcCalls, []);
});

Deno.test("invite-user refuses a platform_admin inviting into a demo tenant", async () => {
  const { handler, rpcCalls } = makeHandler({
    callerRole: "platform_admin",
    callerOrgId: null,
    demoOrgIds: [DEMO_ORG_ID],
  });

  const response = await handler(makeRequest({
    email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "facility_manager",
    organization_id: DEMO_ORG_ID,
  }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Demo workspaces cannot invite or provision users");
  assertEquals(rpcCalls, []);
});

const FACILITY_ID = "77777777-7777-4777-8777-777777777777";
const delegatedAuthority = (patch: Partial<DelegatedInviteAuthority> = {}): DelegatedInviteAuthority => ({
  actorId: CALLER_ID, organizationId: ORG_ID, role: "org_admin", email: EMAIL,
  firstName: "Rae", lastName: "Nolan", employeeId: null, facilityId: null,
  revalidate: async () => {}, provisionProfile: async invitedId => ({ id: invitedId, is_active: true }), ...patch,
});
const delegatedBody = { email: EMAIL, first_name: "Rae", last_name: "Nolan", role: "org_admin", organization_id: ORG_ID };
const internalRequest = (body: unknown) => new Request("https://example.test/internal/invitation", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

Deno.test("ordinary invite authentication cannot be replaced by body fields or an absent header", async () => {
  const { handler, observations } = makeHandler();
  const response = await handler(internalRequest({ ...delegatedBody, delegatedAuthority: delegatedAuthority() }));
  assertEquals(response.status, 401);
  assertEquals(observations.invites, 0);
});

Deno.test("ordinary invite still requires current native MFA", async () => {
  const { handler, observations } = makeHandler({ assuranceAllowed: false });
  const response = await handler(makeRequest(delegatedBody));
  assertEquals(response.status, 403);
  assertEquals(observations.authLookups, 1);
  assertEquals(observations.assuranceChecks, 1);
  assertEquals(observations.invites, 0);
});

Deno.test("server-injected Hub invite uses exact scoped authority and existing profile/lifecycle writes", async () => {
  let checks = 0, provisionedId = "";
  const { handler, observations, rpcCalls } = makeHandler({ callerRole: "platform_admin", callerOrgId: null,
    delegatedAuthority: delegatedAuthority({ revalidate: async () => { checks++; }, provisionProfile: async invitedId => { provisionedId=invitedId;return { id: invitedId }; } }) });
  const response = await handler(internalRequest(delegatedBody));
  assertEquals(response.status, 200);
  assertEquals(checks, 2);
  assertEquals(observations.authLookups, 0, "no native user session is fabricated");
  assertEquals(observations.assuranceChecks, 0, "delegated SMS does not claim native AAL2");
  assertEquals(observations.invites, 1);
  assertEquals(provisionedId, INVITED_ID);
  assertEquals(rpcCalls.map(call=>call.name), ["record_user_invitation_sent"]);
  assertEquals(rpcCalls[0].args.p_created_by, CALLER_ID);
});

for(const changed of [{role:"platform_admin"},{organization_id:DEMO_ORG_ID},{email:"other@example.test"},
  {first_name:"Changed"},{employee_id:EMPLOYEE_ID},{redirect_to:"https://cmcarebase.com/reset-password"}]) {
  Deno.test(`delegated invite rejects a changed ${Object.keys(changed)[0]} before email`, async () => {
    const {handler,observations}=makeHandler({callerRole:"platform_admin",callerOrgId:null,delegatedAuthority:delegatedAuthority()});
    assertEquals((await handler(internalRequest({...delegatedBody,...changed}))).status,403);
    assertEquals(observations.invites,0);
  });
}

Deno.test("delegated employee lookup includes its exact facility and employee", async () => {
  const {handler,observations}=makeHandler({callerRole:"platform_admin",callerOrgId:null,
    employeeMatches:[{id:EMPLOYEE_ID,profile_id:null,email:EMAIL}],
    delegatedAuthority:delegatedAuthority({role:"employee",facilityId:FACILITY_ID,employeeId:EMPLOYEE_ID})});
  assertEquals((await handler(internalRequest({...delegatedBody,role:"employee",employee_id:EMPLOYEE_ID}))).status,200);
  assertEquals(observations.employeeFilters,[["organization_id",ORG_ID],["facility_id",FACILITY_ID],["id",EMPLOYEE_ID]]);
});

Deno.test("delegated authority revoked before sending cannot dispatch email", async () => {
  let checks=0;
  const {handler,observations}=makeHandler({callerRole:"platform_admin",callerOrgId:null,
    delegatedAuthority:delegatedAuthority({revalidate:async()=>{if(++checks===2)throw new Error("revoked");}})});
  assertEquals((await handler(internalRequest(delegatedBody))).status,403);
  assertEquals(observations.invites,0);
});

Deno.test("delegated resend revalidates the exact authority before metadata refresh and again before dispatch", async () => {
  let checks = 0;
  const { handler, observations, resend } = makeHandler({ callerRole: "platform_admin", callerOrgId: null,
    existingProfiles: [returningProfile], delegatedAuthority: delegatedAuthority({ revalidate: async () => { checks++; } }) });
  assertEquals((await handler(internalRequest(delegatedBody))).status, 200);
  assertEquals(checks, 3); assertEquals(resend.events, ["refresh", "send"]); assertEquals(observations.assuranceChecks, 0);
});

for (const revokedCheck of [2, 3]) {
  Deno.test(`delegated resend authority revoked at check ${revokedCheck} never sends`, async () => {
    let checks = 0;
    const { handler, observations, resend } = makeHandler({ callerRole: "platform_admin", callerOrgId: null,
      existingProfiles: [returningProfile], delegatedAuthority: delegatedAuthority({ revalidate: async () => { if (++checks === revokedCheck) throw new Error("Revoked"); } }) });
    assertEquals((await handler(internalRequest(delegatedBody))).status, 403);
    assertEquals(resend.updates.length, revokedCheck === 2 ? 0 : 1); assertEquals(observations.invites, 0);
    assertEquals(observations.deletes, 0);
  });
}

Deno.test("delegated invite still refuses a demoted native actor", async () => {
  const {handler,observations}=makeHandler({delegatedAuthority:delegatedAuthority()});
  assertEquals((await handler(internalRequest(delegatedBody))).status,403);
  assertEquals(observations.invites,0);
});

Deno.test("delegated profile race conflict never invokes broad provisioning or deletes the winning identity", async () => {
  const {handler,observations,rpcCalls}=makeHandler({callerRole:"platform_admin",callerOrgId:null,
    delegatedAuthority:delegatedAuthority({provisionProfile:async()=>{throw new Error("Identity claimed by another organization");}})});
  await assertRejects(()=>handler(internalRequest(delegatedBody)),Error,"Identity claimed");
  assertEquals(observations.invites,1);
  assertEquals(observations.deletes,0);
  assertEquals(rpcCalls,[]);
});

for(const failure of [
  {code:"email_exists",status:422,rejected:true},
  {code:"over_email_send_rate_limit",status:429,rejected:true},
  {code:"unexpected_failure",status:500,rejected:false},
  {code:"unknown_client_error",status:400,rejected:false},
  {code:"email_exists",status:500,rejected:false},
]) Deno.test(`delegated delivery classifies only definite rejection ${failure.code}/${failure.status}`,async()=>{
  let started=0,rejected=0;
  const {handler,observations,rpcCalls}=makeHandler({callerRole:"platform_admin",callerOrgId:null,
    inviteError:{...failure,message:"provider rejected"},delegatedAuthority:delegatedAuthority({
      beforeEmailDispatch:()=>{started++;},deliveryRejected:()=>{rejected++;},
    })});
  assertEquals((await handler(internalRequest(delegatedBody))).status,400);
  assertEquals(started,1);assertEquals(rejected,failure.rejected?1:0);
  assertEquals(observations.deletes,0);assertEquals(rpcCalls,[]);
});

Deno.test("delegated transport failure remains uncertain after dispatch begins",async()=>{
  let started=0,rejected=0;
  const {handler}=makeHandler({callerRole:"platform_admin",callerOrgId:null,inviteThrows:true,
    delegatedAuthority:delegatedAuthority({beforeEmailDispatch:()=>{started++;},deliveryRejected:()=>{rejected++;}})});
  await assertRejects(()=>handler(internalRequest(delegatedBody)),Error,"provider timeout");
  assertEquals(started,1);assertEquals(rejected,0);
});
