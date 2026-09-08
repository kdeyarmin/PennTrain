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
  assurance?: boolean;
  bindError?: boolean;
  boundRowMissing?: boolean;
  exchangeError?: boolean;
  exchangedUserId?: string;
} = {}) {
  const generateLinkCalls: unknown[] = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const events: string[] = [];
  const revoked: string[] = [];

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
    rpc: async () => ({ data: opts.assurance ?? true, error: null }),
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
        signOut: async (token: string) => { revoked.push(token); return { error: null }; },
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
          update: (row: Record<string, unknown>) => {
            events.push("bind");
            inserts.push({ table, row });
            const query = {
              eq: () => query, is: () => query, gt: () => query, select: () => query,
              maybeSingle: async () => ({
                data: opts.boundRowMissing ? null : { id: "session-1" },
                error: opts.bindError ? { message: "bind failed" } : null,
              }),
            };
            return query;
          },
        };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
  };

  const sessionClient = {
    auth: { verifyOtp: async () => {
      events.push("exchange");
      return opts.exchangeError ? { data: null, error: { message: "exchange failed" } } : {
        data: { session: {
          access_token: testAccessToken("target-session"), refresh_token: "target-refresh",
          user: { id: opts.exchangedUserId ?? TARGET_ID },
        } }, error: null,
      };
    } },
  };
  const createClient = (_url: string, key: string, options?: Record<string, unknown>) => {
    if (key === ENV.SUPABASE_SERVICE_ROLE_KEY) return adminClient;
    return options?.global ? callerClient : sessionClient;
  };
  return {
    handler: createImpersonateUserHandler({ createClient, getEnv }),
    generateLinkCalls,
    inserts,
    events,
    revoked,
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
  const { handler, generateLinkCalls, inserts, events } = makeHandler();

  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "Investigating a support ticket",
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.token_hash, undefined, "an unbound magic-link credential must never reach the browser");
  assertEquals(body.session, { access_token: testAccessToken("target-session"), refresh_token: "target-refresh" });
  assertEquals(events, ["exchange", "bind"]);
  assertEquals(body.impersonation_id, "session-1");
  assertEquals(typeof body.context_secret, "string");
  assertEquals(generateLinkCalls.length, 1);
  assertEquals(inserts.some((row) => tableMatches(row, "audit_logs")), true);
  assertEquals(inserts.some((row) => tableMatches(row, "impersonation_sessions")), true);
});

for (const failure of ["exchangeError", "bindError", "boundRowMissing", "exchangedUserId"] as const) {
  Deno.test(`impersonate-user never returns usable credentials after ${failure}`, async () => {
    const { handler, revoked } = makeHandler(failure === "exchangedUserId"
      ? { exchangedUserId: ADMIN_ID } : { [failure]: true });
    const response = await handler(makeRequest({ action: "start", target_user_id: TARGET_ID, reason: "support ticket" }));
    const body = await response.json();
    assertEquals(response.status, 500);
    assertEquals(body.session, undefined);
    assertEquals(body.token_hash, undefined);
    assertEquals(revoked, failure === "exchangeError" ? [] : [testAccessToken("target-session")]);
  });
}

function tableMatches(row: { table: string }, name: string) {
  return row.table === name;
}

Deno.test("impersonate-user requires fresh MFA before minting a target credential", async () => {
  const { handler, generateLinkCalls, inserts } = makeHandler({ assurance: false });
  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "support ticket",
  }));
  assertEquals(response.status, 403);
  assertEquals(generateLinkCalls, []);
  assertEquals(inserts, []);
});

for (const body of [null, [], "start", { action: "start", target_user_id: TARGET_ID, reason: 123 },
  { action: "start", target_user_id: { id: TARGET_ID }, reason: "support ticket" },
  { action: "bind", impersonation_id: {}, context_secret: "secret" },
  { action: "end", impersonation_id: "session-1", context_secret: [] }]) {
  Deno.test(`impersonate-user rejects malformed body ${JSON.stringify(body)}`, async () => {
    const { handler, generateLinkCalls, inserts } = makeHandler();
    const response = await handler(makeRequest(body));
    assertEquals(response.status, 400);
    assertEquals(generateLinkCalls, []);
    assertEquals(inserts, []);
  });
}

Deno.test("impersonate-user caps the request before creating an impersonation", async () => {
  const { handler, generateLinkCalls, inserts } = makeHandler();
  const response = await handler(makeRequest({
    action: "start", target_user_id: TARGET_ID, reason: "a".repeat(16_384),
  }));
  assertEquals(response.status, 413);
  assertEquals(generateLinkCalls, []);
  assertEquals(inserts, []);
});

async function makeBindHandler(race: "none" | "bind" | "end" | "expire", boundSession: string | null = null) {
  const contextSecret = "context-secret";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contextSecret));
  const context = {
    id: "context-1", target_profile_id: CALLER_ID, actor_profile_id: ADMIN_ID,
    target_organization_id: ORG_ID, target_session_id: boundSession,
    context_secret_sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    reason: "support ticket", expires_at: new Date(Date.now() + 60_000).toISOString(), ended_at: null as string | null,
  };
  let updates = 0;
  const callerClient = {
    auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    from: () => chainable({ data: { role: "employee", is_active: true, organization_id: ORG_ID }, error: null }),
  };
  const adminClient = {
    from: (table: string) => {
      if (table !== "impersonation_sessions") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => chainable({ data: { ...context }, error: null }),
        update: (values: Partial<typeof context>) => {
          updates += 1;
          // A second request commits after the SELECT but before this conditional UPDATE.
          if (race === "bind") context.target_session_id = "competing-session";
          if (race === "end") context.ended_at = new Date().toISOString();
          if (race === "expire") context.expires_at = new Date(Date.now() - 1).toISOString();
          const matches: Array<() => boolean> = [];
          // deno-lint-ignore no-explicit-any
          const query: any = {};
          const equal = (column: keyof typeof context, value: unknown) => {
            matches.push(() => context[column] === value);
            return query;
          };
          query.eq = equal;
          query.is = equal;
          query.gt = (column: "expires_at", value: string) => {
            matches.push(() => context[column] > value);
            return query;
          };
          query.select = () => query;
          query.maybeSingle = async () => {
            if (!matches.every((match) => match())) return { data: null, error: null };
            Object.assign(context, values);
            return { data: { id: context.id }, error: null };
          };
          return query;
        },
      };
    },
  };
  const handler = createImpersonateUserHandler({
    createClient: (_url, key) => key === ENV.SUPABASE_ANON_KEY ? callerClient : adminClient,
    getEnv,
  });
  return {
    handler, context, updates: () => updates,
    request: () => makeRequest({ action: "bind", impersonation_id: context.id, context_secret: contextSecret }),
  };
}

Deno.test("impersonate-user binds an unclaimed live context", async () => {
  const test = await makeBindHandler("none");
  assertEquals((await test.handler(test.request())).status, 200);
  assertEquals(test.context.target_session_id, "sess-1");
});

for (const race of ["bind", "end", "expire"] as const) {
  Deno.test(`impersonate-user refuses a context changed concurrently by ${race}`, async () => {
    const test = await makeBindHandler(race);
    assertEquals((await test.handler(test.request())).status, 409);
    assertEquals(test.context.target_session_id, race === "bind" ? "competing-session" : null);
  });
}

Deno.test("impersonate-user retrying the same bind does not rewrite its lifecycle", async () => {
  const test = await makeBindHandler("none", "sess-1");
  assertEquals((await test.handler(test.request())).status, 200);
  assertEquals(test.updates(), 0);
});

Deno.test("impersonate-user cannot bind another session's context", async () => {
  const test = await makeBindHandler("none", "another-session");
  assertEquals((await test.handler(test.request())).status, 409);
  assertEquals(test.context.target_session_id, "another-session");
  assertEquals(test.updates(), 0);
});

Deno.test("impersonate-user can revoke an expired context without reading the now-blocked target profile", async () => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("context-secret"));
  const context = {
    id: "context-1", target_profile_id: CALLER_ID, actor_profile_id: ADMIN_ID,
    target_organization_id: ORG_ID, target_session_id: "sess-1",
    context_secret_sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    reason: "support ticket", expires_at: new Date(Date.now() - 1_000).toISOString(), ended_at: null,
  };
  const revoked: Array<{ token: string; scope: string }> = [];
  const auditRows: Record<string, unknown>[] = [];
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    from: () => { throw new Error("expired target profile reads are blocked"); },
  };
  const admin = {
    auth: { admin: { signOut: async (token: string, scope: string) => {
      revoked.push({ token, scope });
      return { error: null };
    } } },
    from: (table: string) => {
      if (table === "audit_logs") return { insert: async (row: Record<string, unknown>) => {
        auditRows.push(row);
        return { error: null };
      } };
      if (table === "impersonation_sessions") return {
        select: () => chainable({ data: context, error: null }),
        update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }),
      };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const handler = createImpersonateUserHandler({
    createClient: (_url, key) => key === ENV.SUPABASE_ANON_KEY ? caller : admin, getEnv,
  });
  const response = await handler(makeRequest({
    action: "end", impersonation_id: context.id, context_secret: "context-secret",
  }));
  assertEquals(response.status, 200);
  assertEquals(revoked, [{ token: testAccessToken(), scope: "local" }]);
  assertEquals((auditRows[0].new_values as Record<string, unknown>).ended_after_expiry, true);
});
