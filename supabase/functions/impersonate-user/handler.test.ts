import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createImpersonateUserHandler } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const getEnv = (name: string) => ENV[name];

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";

function testAccessToken(sessionId = "sess-1"): string {
  const payload = btoa(JSON.stringify({ session_id: sessionId })).replaceAll("=", "");
  return `test.${payload}.sig`;
}

function makeRequest(body: unknown, token = testAccessToken()): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function chainable(result: { data: unknown; error: unknown }) {
  // deno-lint-ignore no-explicit-any
  const obj: any = {};
  const self = () => obj;
  for (const method of ["select", "eq", "insert", "update", "is"]) obj[method] = self;
  obj.single = async () => result;
  obj.maybeSingle = async () => result;
  return obj;
}

function makeHandler(opts: {
  callerRole?: string;
  targetRole?: string;
  targetActive?: boolean;
  emailConfirmedAt?: string | null;
  lastSignInAt?: string | null;
} = {}) {
  const generateLinkCalls: unknown[] = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

  const callerClient = {
    auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: {
            role: opts.callerRole ?? "platform_admin",
            organization_id: null,
            is_active: true,
          },
          error: null,
        });
      }
      throw new Error(`unexpected caller table: ${table}`);
    },
    rpc: async () => ({ data: true, error: null }),
  };

  const adminClient = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: TARGET_ID,
              email_confirmed_at: opts.emailConfirmedAt === undefined
                ? "2026-09-01T00:00:00Z"
                : opts.emailConfirmedAt,
              last_sign_in_at: opts.lastSignInAt === undefined
                ? "2026-09-01T00:00:00Z"
                : opts.lastSignInAt,
            },
          },
          error: null,
        }),
        generateLink: async (args: unknown) => {
          generateLinkCalls.push(args);
          return {
            data: { properties: { hashed_token: "hash-token" } },
            error: null,
          };
        },
        signOut: async () => ({ error: null }),
      },
    },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: {
            id: TARGET_ID,
            email: "target@example.test",
            role: opts.targetRole ?? "trainer",
            organization_id: ORG_ID,
            is_active: opts.targetActive ?? true,
            first_name: "Pat",
            last_name: "Target",
          },
          error: null,
        });
      }
      if (table === "audit_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return { error: null };
          },
        };
      }
      if (table === "impersonation_sessions") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "session-1", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() },
                  error: null,
                }),
              }),
            };
          },
          select: () => chainable({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
  };

  let callCount = 0;
  const createClient = () => {
    callCount += 1;
    return callCount === 1 ? callerClient : adminClient;
  };
  return {
    handler: createImpersonateUserHandler({ createClient, getEnv }),
    generateLinkCalls,
    inserts,
  };
}

Deno.test("impersonate-user refuses an org_admin starting impersonation", async () => {
  const { handler, generateLinkCalls } = makeHandler({ callerRole: "org_admin" });

  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "not authorized to impersonate users");
  assertEquals(generateLinkCalls, []);
});

Deno.test("impersonate-user refuses impersonating yourself", async () => {
  const { handler, generateLinkCalls } = makeHandler();

  const response = await handler(makeRequest({
    action: "start", target_user_id: CALLER_ID, reason: "support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error, "cannot impersonate yourself");
  assertEquals(generateLinkCalls, []);
});

Deno.test("impersonate-user refuses impersonating another platform_admin", async () => {
  const { handler, generateLinkCalls } = makeHandler({ targetRole: "platform_admin" });

  const response = await handler(makeRequest({
    action: "start", target_user_id: ADMIN_ID, reason: "support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "cannot impersonate another platform_admin");
  assertEquals(generateLinkCalls, []);
});

Deno.test("impersonate-user refuses a deactivated target", async () => {
  const { handler, generateLinkCalls } = makeHandler({ targetActive: false });

  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "cannot impersonate a deactivated user");
  assertEquals(generateLinkCalls, []);
});

Deno.test("impersonate-user refuses an invitee who has never signed in", async () => {
  const { handler, generateLinkCalls } = makeHandler({
    emailConfirmedAt: null,
    lastSignInAt: null,
  });

  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 409);
  assertEquals(body.error.includes("never signed in"), true);
  assertEquals(generateLinkCalls, []);
});

Deno.test("impersonate-user starts a bounded session for a confirmed tenant user", async () => {
  const { handler, generateLinkCalls, inserts } = makeHandler();

  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "Investigating a support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.token_hash, "hash-token");
  assertEquals(body.impersonation_id, "session-1");
  assertEquals(typeof body.context_secret, "string");
  assertEquals(generateLinkCalls.length, 1);
  assertEquals(inserts.some((row) => tableMatches(row, "audit_logs")), true);
  assertEquals(inserts.some((row) => tableMatches(row, "impersonation_sessions")), true);
});

function tableMatches(row: { table: string }, name: string) {
  return row.table === name;
}
