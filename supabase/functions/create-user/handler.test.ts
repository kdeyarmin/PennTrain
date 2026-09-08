import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createCreateUserHandler } from "./handler.ts";

// create-user is the one identity function that never had a request-path test. The comment on
// useCreateUserViaAdmin() used to say role and organization_id went in user_metadata -- which is
// exactly the trust boundary handle_new_user() stopped reading in 20260704180244, because
// user_metadata is what an unauthenticated POST /auth/v1/signup can set. These tests pin the
// Admin API call onto app_metadata, and pin the authorization matrix the Users page claims.

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const getEnv = (name: string) => ENV[name];

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_ORG_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ORG_ID = "77777777-7777-4777-8777-777777777777";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_ID = "44444444-4444-4444-8444-444444444444";
const EMAIL = "new.user@example.test";

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
  createUserCalls: Record<string, unknown>[];
  profileRpcArgs: Record<string, unknown>[];
  deletedUserIds: string[];
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    password: "temporary1",
    first_name: "Ada",
    last_name: "Lovelace",
    role: "trainer",
    organization_id: ORG_ID,
    ...overrides,
  };
}

function makeHandler(opts: {
  callerRole: string;
  callerOrgId?: string | null;
  callerActive?: boolean;
  demoOrgIds?: string[];
  aal2?: boolean;
  aal2Error?: { message: string } | null;
  createError?: { message: string } | null;
  profileRpcError?: { message: string } | null;
}) {
  const track: Tracking = { createUserCalls: [], profileRpcArgs: [], deletedUserIds: [] };
  const demoOrgIds = new Set(opts.demoOrgIds ?? []);

  const callerClient = {
    auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: {
            role: opts.callerRole,
            organization_id: opts.callerOrgId === undefined ? ORG_ID : opts.callerOrgId,
            is_active: opts.callerActive ?? true,
          },
          error: null,
        });
      }
      if (table === "organizations") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => ({
                data: { is_demo: demoOrgIds.has(value) },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected caller table: ${table}`);
    },
    rpc: async (name: string) => {
      if (name === "identity_assurance_is_current") {
        if (opts.aal2Error) return { data: null, error: opts.aal2Error };
        return { data: opts.aal2 ?? true, error: null };
      }
      return { data: true, error: null };
    },
  };

  const adminClient = {
    auth: {
      admin: {
        createUser: async (attributes: Record<string, unknown>) => {
          track.createUserCalls.push(attributes);
          if (opts.createError) return { data: null, error: opts.createError };
          return { data: { user: { id: CREATED_ID, email: EMAIL } }, error: null };
        },
        deleteUser: async (id: string) => {
          track.deletedUserIds.push(id);
          return { data: null, error: null };
        },
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "admin_update_profile") track.profileRpcArgs.push(args);
      if (opts.profileRpcError) return { data: null, error: opts.profileRpcError };
      return { data: { id: CREATED_ID, role: args.p_role }, error: null };
    },
  };

  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1 ? callerClient : adminClient;
  };
  return { handler: createCreateUserHandler({ createClient, getEnv }), track };
}

Deno.test("create-user puts role and organization_id in app_metadata, never user_metadata", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin" });

  const response = await handler(makeRequest(validBody()));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.user.id, CREATED_ID);
  assertEquals(track.createUserCalls.length, 1);
  const call = track.createUserCalls[0];
  assertEquals(call.email_confirm, true);
  assertEquals(call.user_metadata, { first_name: "Ada", last_name: "Lovelace" });
  assertEquals(call.app_metadata, { role: "trainer", organization_id: ORG_ID });
  assertEquals(track.profileRpcArgs.length, 1);
  assertEquals(track.profileRpcArgs[0].p_role, "trainer");
  assertEquals(track.profileRpcArgs[0].p_organization_id, ORG_ID);
  assertEquals(track.profileRpcArgs[0].p_is_active, true);
});

Deno.test("create-user refuses an org_admin creating a platform_admin", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin" });

  const response = await handler(makeRequest(validBody({ role: "platform_admin" })));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "org_admin cannot create platform_admin users");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses a facility_manager creating an org_admin", async () => {
  const { handler, track } = makeHandler({ callerRole: "facility_manager" });

  const response = await handler(makeRequest(validBody({ role: "org_admin" })));

  assertEquals(response.status, 403);
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses a trainer who is not allowed to create anyone", async () => {
  const { handler, track } = makeHandler({ callerRole: "trainer" });

  const response = await handler(makeRequest(validBody()));

  assertEquals(response.status, 403);
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses an org_admin creating into another organization", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin" });

  const response = await handler(makeRequest(validBody({ organization_id: OTHER_ORG_ID })));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "org_admin can only create users within their own organization");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses when the caller's workspace is a demo tenant", async () => {
  const { handler, track } = makeHandler({
    callerRole: "org_admin",
    demoOrgIds: [ORG_ID],
  });

  const response = await handler(makeRequest(validBody()));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Demo workspaces cannot invite or provision users");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses a platform_admin provisioning into a demo tenant", async () => {
  const { handler, track } = makeHandler({
    callerRole: "platform_admin",
    callerOrgId: null,
    demoOrgIds: [DEMO_ORG_ID],
  });

  const response = await handler(makeRequest(validBody({
    role: "org_admin",
    organization_id: DEMO_ORG_ID,
  })));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Demo workspaces cannot invite or provision users");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user still lets a platform_admin create a peer platform_admin (no org)", async () => {
  const { handler, track } = makeHandler({
    callerRole: "platform_admin",
    callerOrgId: null,
  });

  const response = await handler(makeRequest(validBody({
    role: "platform_admin",
    organization_id: undefined,
  })));

  assertEquals(response.status, 200);
  assertEquals(track.createUserCalls[0].app_metadata, {
    role: "platform_admin",
    organization_id: null,
  });
});

Deno.test("create-user requires organization_id when a platform_admin creates a tenant role", async () => {
  const { handler, track } = makeHandler({
    callerRole: "platform_admin",
    callerOrgId: null,
  });

  const response = await handler(makeRequest(validBody({
    role: "org_admin",
    organization_id: undefined,
  })));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "organization_id is required for non-platform_admin users");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user rejects a non-UUID organization_id before it reaches Auth", async () => {
  const { handler, track } = makeHandler({ callerRole: "platform_admin", callerOrgId: null });

  const response = await handler(makeRequest(validBody({ organization_id: "not-a-uuid" })));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "organization_id must be a valid UUID");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses a short password", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin" });

  const response = await handler(makeRequest(validBody({ password: "short" })));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "password must be at least 8 characters");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses when the privileged window is not current", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", aal2: false });

  const response = await handler(makeRequest(validBody()));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Recent multi-factor authentication is required");
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user refuses an inactive caller", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", callerActive: false });

  const response = await handler(makeRequest(validBody()));

  assertEquals(response.status, 403);
  assertEquals(track.createUserCalls, []);
});

Deno.test("create-user lets a facility_manager create a trainer in their own org", async () => {
  const { handler, track } = makeHandler({ callerRole: "facility_manager" });

  const response = await handler(makeRequest(validBody({ role: "trainer", organization_id: undefined })));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(track.createUserCalls[0].app_metadata, {
    role: "trainer",
    organization_id: ORG_ID,
  });
  assertEquals(track.profileRpcArgs[0].p_role, "trainer");
  assertEquals(track.deletedUserIds, []);
});

Deno.test("create-user deletes the auth user when admin_update_profile fails", async () => {
  const { handler, track } = makeHandler({
    callerRole: "org_admin",
    profileRpcError: { message: "profile write failed" },
  });

  const response = await handler(makeRequest(validBody()));
  const body = await response.json();

  assertEquals(response.status, 500);
  assertEquals(body.error, "User provisioning failed; no account was created");
  assertEquals(track.createUserCalls.length, 1);
  assertEquals(track.deletedUserIds, [CREATED_ID]);
});
