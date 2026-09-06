import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createInviteUserHandler } from "./handler.ts";

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

function makeHandler(opts: { employeeMatches?: unknown[] } = {}) {
  const rpcCalls: RpcCall[] = [];

  const callerClient = {
    auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: { role: "org_admin", organization_id: ORG_ID, is_active: true },
          error: null,
        });
      }
      if (table === "organizations") return chainable({ data: { is_demo: false }, error: null });
      if (table === "employees") return chainable({ data: opts.employeeMatches ?? [], error: null });
      throw new Error(`unexpected caller table: ${table}`);
    },
    rpc: async () => ({ data: true, error: null }),
  };

  const adminClient = {
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ data: { user: { id: INVITED_ID, email: EMAIL } }, error: null }),
        deleteUser: async () => ({ data: null, error: null }),
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
  return { handler: createInviteUserHandler({ createClient, getEnv }), rpcCalls };
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
