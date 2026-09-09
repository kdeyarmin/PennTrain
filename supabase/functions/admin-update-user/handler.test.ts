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
const DEMO_ORG_ID = "66666666-6666-4666-8666-666666666666";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const PEER_ID = "33333333-3333-4333-8333-333333333333";

function makeRequest(body: unknown): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

for (const body of [null, [], true, { note: "x".repeat(16_384) },
  { user_id: PEER_ID, is_active: "false" }, { user_id: PEER_ID, password: 123456789 },
  { user_id: PEER_ID, action: "reset_mfa", reason: {} }, { user_id: PEER_ID, email: [] }]) {
  Deno.test(`admin-update-user rejects malformed or oversized identity fields ${JSON.stringify(body).slice(0, 90)}`, async () => {
    const { handler, track } = makeHandler({ callerRole: "platform_admin", targetRole: "employee" });
    const response = await handler(makeRequest(body));
    assertEquals(response.status, body && typeof body === "object" && "note" in body ? 413 : 400);
    assertEquals(track.authUpdates, []);
    assertEquals(track.profileRpcArgs, []);
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
  targetReads: string[];
  authUpdates: Record<string, unknown>[];
  profileRpcArgs: Record<string, unknown>[];
  assuranceCalls: Record<string, unknown>[];
  listedFactorUsers: string[];
  revokedSessions: Record<string, unknown>[];
  smsResets: Record<string, unknown>[];
  deletedFactors: Array<{ id: string; userId: string }>;
  auditRows: Record<string, unknown>[];
  resetEvents: string[];
}

function makeHandler(opts: {
  callerRole: string;
  targetRole: string;
  demoOrgIds?: string[];
  callerAuthenticated?: boolean;
  assurance?: boolean;
  assuranceError?: boolean;
  nativeFactorIds?: string[];
  revokeError?: boolean;
  smsRemoved?: number | null;
  smsResetError?: boolean;
}) {
  const track: Tracking = {
    targetReads: [], authUpdates: [], profileRpcArgs: [], assuranceCalls: [], listedFactorUsers: [],
    revokedSessions: [], smsResets: [], deletedFactors: [], auditRows: [], resetEvents: [],
  };
  const demoOrgIds = new Set(opts.demoOrgIds ?? []);

  const callerClient = {
    auth: { getUser: async () => opts.callerAuthenticated === false
      ? { data: { user: null }, error: { message: "invalid session" } }
      : { data: { user: { id: CALLER_ID } }, error: null } },
    from: (table: string) => {
      if (table === "profiles") {
        return chainable({
          data: { role: opts.callerRole, organization_id: ORG_ID, is_active: true },
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "identity_assurance_is_current") {
        track.assuranceCalls.push(args);
        return {
          data: opts.assurance ?? true,
          error: opts.assuranceError ? { message: "assurance unavailable" } : null,
        };
      }
      if (name === "revoke_identity_sessions") {
        track.revokedSessions.push(args);
        track.resetEvents.push("revoke sessions");
        return { data: null, error: opts.revokeError ? { message: "revocation unavailable" } : null };
      }
      throw new Error(`unexpected caller RPC: ${name}`);
    },
  };

  const adminClient = {
    auth: {
      admin: {
        mfa: {
          listFactors: async ({ userId }: { userId: string }) => {
            track.listedFactorUsers.push(userId);
            return { data: { factors: (opts.nativeFactorIds ?? []).map((id) => ({ id })) }, error: null };
          },
          deleteFactor: async (args: { id: string; userId: string }) => {
            track.deletedFactors.push(args);
            track.resetEvents.push(`remove native ${args.id}`);
            return { error: null };
          },
        },
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
        track.targetReads.push("profile");
        return chainable({
          data: { id: PEER_ID, role: opts.targetRole, organization_id: ORG_ID },
          error: null,
        });
      }
      if (table === "audit_logs") {
        return { insert: async (row: Record<string, unknown>) => {
          track.auditRows.push(row);
          track.resetEvents.push("audit reset");
          return { error: null };
        } };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "reset_sms_mfa_factor") {
        track.smsResets.push(args);
        track.resetEvents.push("remove SMS");
        return {
          data: opts.smsRemoved === undefined ? 0 : opts.smsRemoved,
          error: opts.smsResetError ? { message: "private storage unavailable" } : null,
        };
      }
      if (name !== "admin_update_profile") throw new Error(`unexpected admin RPC: ${name}`);
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

Deno.test("admin-update-user refuses a facility_manager entirely", async () => {
  const { handler, track } = makeHandler({ callerRole: "facility_manager", targetRole: "employee" });

  const response = await handler(makeRequest({ user_id: PEER_ID, role: "trainer" }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "not authorized to manage users");
  assertEquals(track.authUpdates, []);
  assertEquals(track.profileRpcArgs, []);
});

Deno.test("admin-update-user refuses reset_mfa from an org_admin", async () => {
  const { handler, track } = makeHandler({ callerRole: "org_admin", targetRole: "facility_manager" });

  const response = await handler(makeRequest({
    action: "reset_mfa", user_id: PEER_ID, reason: "Lost phone, identified by facility callback",
  }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error.includes("platform administrator"), true);
  assertEquals(track.authUpdates, []);
  assertEquals(track.listedFactorUsers, []);
  assertEquals(track.resetEvents, []);
});

Deno.test("admin-update-user refuses reset_mfa aimed at the caller's own account", async () => {
  const { handler, track } = makeHandler({ callerRole: "platform_admin", targetRole: "org_admin" });

  const response = await handler(makeRequest({
    action: "reset_mfa", user_id: CALLER_ID, reason: "Lost phone, identified by facility callback",
  }));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body.error.includes("own factor"), true);
  assertEquals(track.listedFactorUsers, []);
  assertEquals(track.resetEvents, []);
});

const RESET_REASON = "Lost phone, identified by facility callback";

for (const nativeFactorIds of [[], ["totp-factor", "native-phone-factor"]]) {
  Deno.test(`admin-update-user resets SMS${nativeFactorIds.length ? " and native factors" : "-only MFA"} after signing out the target`, async () => {
    const { handler, track } = makeHandler({
      callerRole: "platform_admin", targetRole: "org_admin", nativeFactorIds, smsRemoved: 1,
    });

    const response = await handler(makeRequest({
      action: "reset_mfa", user_id: PEER_ID, reason: `  ${RESET_REASON}  `,
    }));
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body, { success: true, removed_factor_ids: nativeFactorIds, requires_reenrolment: true });
    assertEquals(track.assuranceCalls, [{ p_operation: "identity_admin" }]);
    assertEquals(track.listedFactorUsers, [PEER_ID]);
    assertEquals(track.revokedSessions, [{
      p_profile_id: PEER_ID,
      p_reason: `MFA reset: ${RESET_REASON}`,
      p_source: "administrator",
      p_external_request_id: null,
      p_deactivate_profile: false,
    }]);
    assertEquals(track.smsResets, [{
      p_profile_id: PEER_ID, p_actor_profile_id: CALLER_ID, p_reason: RESET_REASON,
    }]);
    assertEquals(track.deletedFactors, nativeFactorIds.map((id) => ({ id, userId: PEER_ID })));
    assertEquals(track.resetEvents, [
      "revoke sessions", "remove SMS", ...nativeFactorIds.map((id) => `remove native ${id}`), "audit reset",
    ], "all target sessions must be revoked before removing either kind of factor");
    assertEquals(track.auditRows, [{
      organization_id: ORG_ID,
      actor_profile_id: CALLER_ID,
      entity_type: "identity",
      entity_id: PEER_ID,
      action: "mfa_reset",
      reason: RESET_REASON,
      new_values: {
        removed_factor_ids: nativeFactorIds,
        factor_count: nativeFactorIds.length + 1,
        sms_factor_count: 1,
      },
    }]);
    assertEquals(track.authUpdates, []);
    assertEquals(track.profileRpcArgs, []);
  });
}

Deno.test("admin-update-user removes no factors when target-session revocation fails", async () => {
  const { handler, track } = makeHandler({
    callerRole: "platform_admin", targetRole: "org_admin", nativeFactorIds: ["totp-factor"],
    smsRemoved: 1, revokeError: true,
  });

  const response = await handler(makeRequest({ action: "reset_mfa", user_id: PEER_ID, reason: RESET_REASON }));
  const body = await response.json();

  assertEquals(response.status, 500);
  assertEquals(body.error.includes("no factors were removed"), true);
  assertEquals(body.error.includes("revocation unavailable"), false, "internal errors stay out of the response");
  assertEquals(track.resetEvents, ["revoke sessions"]);
  assertEquals(track.smsResets, []);
  assertEquals(track.deletedFactors, []);
  assertEquals(track.auditRows, []);
});

for (const failure of [{ smsResetError: true }, { smsRemoved: null }]) {
  Deno.test(`admin-update-user reports signed-out partial recovery when SMS reset ${"smsResetError" in failure ? "fails" : "returns no count"}`, async () => {
    const { handler, track } = makeHandler({
      callerRole: "platform_admin", targetRole: "org_admin", nativeFactorIds: ["totp-factor"], ...failure,
    });

    const response = await handler(makeRequest({ action: "reset_mfa", user_id: PEER_ID, reason: RESET_REASON }));
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.error, "The user was signed out, but text-message verification could not be reset. Retry the reset.");
    assertEquals(typeof body.correlationId, "string");
    assertEquals(body.success, undefined);
    assertEquals(track.resetEvents, ["revoke sessions", "remove SMS"]);
    assertEquals(track.deletedFactors, [], "keep native factors intact after the SMS reset fails");
    assertEquals(track.auditRows, [], "do not record a completed reset for a partial operation");
  });
}

for (const refusal of [
  { name: "an expired session", options: { callerAuthenticated: false }, status: 401 },
  { name: "a facility manager", options: { callerRole: "facility_manager" }, status: 403 },
  { name: "missing recent MFA", options: { assurance: false }, status: 403 },
  { name: "unavailable MFA assurance", options: { assuranceError: true }, status: 503 },
]) {
  Deno.test(`admin-update-user refuses MFA reset with ${refusal.name} before reading or changing factors`, async () => {
    const { handler, track } = makeHandler({
      callerRole: "platform_admin", targetRole: "org_admin", ...refusal.options,
    });

    const response = await handler(makeRequest({ action: "reset_mfa", user_id: PEER_ID, reason: RESET_REASON }));

    assertEquals(response.status, refusal.status);
    assertEquals(track.targetReads, [], "MFA denial must precede service-role target metadata");
    assertEquals(track.listedFactorUsers, []);
    assertEquals(track.resetEvents, []);
    assertEquals(track.authUpdates, []);
    assertEquals(track.profileRpcArgs, []);
  });
}

Deno.test("admin-update-user refuses a platform_admin moving a user into a demo tenant", async () => {
  const { handler, track } = makeHandler({
    callerRole: "platform_admin",
    targetRole: "employee",
    demoOrgIds: [DEMO_ORG_ID],
  });

  const response = await handler(makeRequest({ user_id: PEER_ID, organization_id: DEMO_ORG_ID }));
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error, "Demo workspaces cannot invite or provision users");
  assertEquals(track.authUpdates, []);
  assertEquals(track.profileRpcArgs, []);
});
