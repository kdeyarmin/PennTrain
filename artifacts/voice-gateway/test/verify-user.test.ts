import { describe, expect, it, vi } from "vitest";
import type { AppDefinition } from "../src/apps/types.js";
import { verifyAppUser } from "../src/auth/verify-user.js";

const SUPABASE_URL = "https://testapp-project.supabase.co";
const MFA_URL = `${SUPABASE_URL}/rest/v1/rpc/current_sms_mfa_satisfied`;
const APP: AppDefinition = {
  id: "testapp",
  displayName: "Test App",
  auth: {
    supabaseUrl: SUPABASE_URL,
    anonKey: "public-anon-key",
    allowedRoles: ["platform_admin"],
  },
  allowedOrigins: [],
  toolCallbackUrl: `${SUPABASE_URL}/functions/v1/voice-tools`,
  tools: { descriptors: [], argSchemas: {} },
  buildInstructions: () => "Test agent",
  agentSpeaksFirst: true,
};

function authFetch(mfaResponse: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      return Response.json({ id: "operator-1" });
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/profiles?`)) {
      // This bootstrap read remains available even before SMS proof exists.
      return Response.json({ role: "platform_admin", is_active: true, organization_id: null });
    }
    if (url === MFA_URL) return mfaResponse();
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("voice caller SMS MFA boundary", () => {
  it("uses the caller token and accepts only the database's boolean approval", async () => {
    const jwt = "exact-caller-token";
    const fetchImpl = authFetch(() => Response.json(true));

    expect(await verifyAppUser(APP, jwt, fetchImpl)).toEqual({
      ok: true,
      user: { userId: "operator-1", role: "platform_admin", organizationId: null },
    });
    expect(fetchImpl).toHaveBeenCalledWith(MFA_URL, {
      method: "POST",
      headers: {
        apikey: "public-anon-key",
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });
  });

  it("does not let a native aal2 token substitute for missing SMS proof", async () => {
    const claims = Buffer.from(JSON.stringify({ sub: "operator-1", aal: "aal2" })).toString("base64url");
    const fetchImpl = authFetch(() => Response.json(false));
    expect(await verifyAppUser(APP, `header.${claims}.signature`, fetchImpl)).toEqual({
      ok: false,
      failure: { status: 403, code: "mfa_required" },
    });
  });

  it.each([401, 403])("denies a session when the database hook returns %i", async (status) => {
    const fetchImpl = authFetch(() => Response.json({ code: "42501", message: "mfa_required" }, { status }));
    expect(await verifyAppUser(APP, "caller-token", fetchImpl)).toEqual({
      ok: false,
      failure: { status: 403, code: "mfa_required" },
    });
  });

  it.each([404, 500, 503])("fails closed when the MFA RPC returns %i", async (status) => {
    const fetchImpl = authFetch(() => new Response("unavailable", { status }));
    expect(await verifyAppUser(APP, "caller-token", fetchImpl)).toEqual({
      ok: false,
      failure: { status: 502, code: "auth_unreachable" },
    });
  });

  it.each([null, "true", 1, { satisfied: true }, [true]])(
    "fails closed on a malformed MFA approval: %j",
    async (body) => {
      const fetchImpl = authFetch(() => Response.json(body));
      expect(await verifyAppUser(APP, "caller-token", fetchImpl)).toEqual({
        ok: false,
        failure: { status: 502, code: "auth_unreachable" },
      });
    },
  );

  it("fails closed on invalid JSON", async () => {
    const fetchImpl = authFetch(() => new Response("not JSON"));
    expect(await verifyAppUser(APP, "caller-token", fetchImpl)).toEqual({
      ok: false,
      failure: { status: 502, code: "auth_unreachable" },
    });
  });

  it("fails closed when the MFA service is unreachable", async () => {
    const fetchImpl = authFetch(() => { throw new Error("network unavailable"); });
    expect(await verifyAppUser(APP, "caller-token", fetchImpl)).toEqual({
      ok: false,
      failure: { status: 502, code: "auth_unreachable" },
    });
  });
});
