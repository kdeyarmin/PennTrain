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
} = {}) {
  const rpcCalls: RpcCall[] = [];
  const observations = { invites: 0, deletes: 0, authLookups: 0, assuranceChecks: 0, employeeFilters: [] as [string,unknown][], inviteOptions: {} as Record<string, unknown>, brandingFilters: [] as [string, unknown][] };
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
    auth: {
      admin: {
        inviteUserByEmail: async (_email: string, options: Record<string, unknown>) => { observations.invites++; observations.inviteOptions = options; if(opts.inviteThrows)throw new Error("provider timeout"); return { data: { user: { id: INVITED_ID, email: EMAIL } }, error: opts.inviteError ?? null }; },
        deleteUser: async () => { observations.deletes++; return { data: null, error: null }; },
      },
    },
    from: () => chainable({ data: null, error: null }),
    rpc: async (name: string, args: Record<string, unknown>) => {
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
    ...(opts.delegatedAuthority ? { resolveDelegatedAuthority: async () => opts.delegatedAuthority! } : {}) }), rpcCalls, observations };
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
