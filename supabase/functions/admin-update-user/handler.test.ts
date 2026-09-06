import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createAdminUpdateUserHandler } from "./handler.ts";

// The takeover this function used to allow, and the ordinary tenant administration it must keep
// allowing. The reset_mfa branch already refuses "an org_admin resetting a peer org_admin's
// factor is a takeover"; setting that peer's password was the same move, unguarded, and stronger:
// it yields a working session that every audit row then attributes to the victim.

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const getEnv = (name: string) => ENV[name];

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const PEER_ID = "33333333-3333-4333-8333-333333333333";

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
  for (const method of ["select", "eq"]) obj[method] = self;
  obj.single = async () => result;
  obj.maybeSingle = async () => result;
  return obj;
}

interface Tracking {
  authUpdates: Record<string, unknown>[];
  profileRpcArgs: Record<string, unknown>[];
}

function makeHandler(opts: { callerRole: string; targetRole: string }) {
  const track: Tracking = { authUpdates: [], profileRpcArgs: [] };

  const callerClient = {
    auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: { role: opts.callerRole, organization_id: ORG_ID, is_active: true },
          error: null,
        });
      }
      if (table === "organizations") return chainable({ data: { is_demo: false }, error: null });
      throw new Error(`unexpected caller table: ${table}`);
    },
    // requireFreshAal2's probe. True here so the tests exercise the authorization branch itself
    // rather than stopping one step earlier on session freshness.
    rpc: async () => ({ data: true, error: null }),
  };

  const adminClient = {
    auth: {
      admin: {
        updateUserById: async (_id: string, attributes: Record<string, unknown>) => {
          track.authUpdates.push(attributes);
          return { data: { user: { id: PEER_ID } }, error: null };
        },
        getUserById: async () => ({
          data: { user: { id: PEER_ID, email: "peer@example.test" } },
          error: null,
        }),
      },
    },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: { id: PEER_ID, role: opts.targetRole, organization_id: ORG_ID },
          error: null,
        });
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      track.profileRpcArgs.push(args);
      return { data: { id: PEER_ID, role: args.p_role }, error: null };
    },
  };

  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1 ? callerClient : adminClient;
  };
  return { handler: createAdminUpdateUserHandler({ createClient, getEnv }), track };
}

Deno.test("admin-update-user refuses an org_admin setting another user's password", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", targetRole: "org_admin" });

  const response = await handler(makeRequest({ user_id: PEER_ID, password: "a-new-password" }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error.includes("only a platform administrator"), true);
  assertEquals(track.authUpdates, [], "no credential may reach the Admin API");
});

Deno.test("admin-update-user refuses an org_admin changing another user's login email", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", targetRole: "facility_manager" });

  const response = await handler(makeRequest({ user_id: PEER_ID, email: "attacker@example.test" }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error.includes("login email"), true);
  assertEquals(track.authUpdates, []);
});

Deno.test("admin-update-user still lets an org_admin change their OWN login email", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", targetRole: "org_admin" });

  const response = await handler(makeRequest({ user_id: CALLER_ID, email: "me@example.test" }));

  assertEquals(response.status, 200);
  assertEquals(track.authUpdates.length, 1);
  assertEquals(track.authUpdates[0].email, "me@example.test");
});

Deno.test("admin-update-user leaves org_admin role/status administration working", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", targetRole: "employee" });

  const response = await handler(makeRequest({ user_id: PEER_ID, role: "trainer", is_active: false }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(track.authUpdates, [], "role and status never touch auth.users");
  assertEquals(track.profileRpcArgs.length, 1);
  assertEquals(track.profileRpcArgs[0].p_role, "trainer");
  assertEquals(track.profileRpcArgs[0].p_is_active, false);
});

Deno.test("admin-update-user keeps both fields available to a platform_admin", async () => {
  const { handler, track } = makeHandler({ callerRole: "platform_admin", targetRole: "org_admin" });

  const response = await handler(makeRequest({
    user_id: PEER_ID, email: "moved@example.test", password: "a-new-password",
  }));

  assertEquals(response.status, 200);
  assertEquals(track.authUpdates.length, 1);
  assertEquals(track.authUpdates[0].email, "moved@example.test");
  assertEquals(track.authUpdates[0].password, "a-new-password");
});
