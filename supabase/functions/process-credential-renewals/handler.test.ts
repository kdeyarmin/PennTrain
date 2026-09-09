import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createProcessCredentialRenewalsHandler } from "./handler.ts";
import { CRON_SECRET_HEADER } from "../_shared/cronAuth.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
};

function fixture(assurance: unknown, error: { code: string } | null = null) {
  const privilegedCalls: string[] = [];
  let callerChecks = 0;
  let cronChecks = 0;
  const profile = { select: () => profile, eq: () => profile,
    single: async () => ({ data: { role: "platform_admin", is_active: true }, error: null }) };
  const handler = createProcessCredentialRenewalsHandler({
    createClient: ((_: string, key: string, options: unknown) => key === "service" ? {
      rpc: async (name: string) => {
        privilegedCalls.push(name);
        if (name === "claim_system_job_execution") return { data: [{ should_execute: true, run_id: "run-1" }], error: null };
        if (name === "claim_credential_renewal_submissions") return { data: [], error: null };
        if (name === "finish_system_job") return { data: null, error: null };
        throw new Error(`unexpected privileged RPC: ${name}`);
      },
    } : {
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
      rpc: async (name: string) => {
        assertEquals(options, { global: { headers: { Authorization: "Bearer user-jwt" } } });
        assertEquals(name, "current_sms_mfa_satisfied");
        callerChecks++;
        return { data: assurance, error };
      },
      from: () => profile,
    }) as never,
    getEnv: (name) => ENV[name],
    authorizeCron: (req) => {
      cronChecks++;
      return req.headers.get(CRON_SECRET_HEADER) === "valid-worker-secret" ? null : new Response(null, { status: 401 });
    },
  });
  return { handler, privilegedCalls, counts: () => ({ callerChecks, cronChecks }) };
}

for (const error of [null, { code: "42501" }]) {
  Deno.test(`renewal worker refuses password-only platform admin before global claims (${error?.code ?? "false"})`, async () => {
    const { handler, privilegedCalls, counts } = fixture(false, error);
    const response = await handler(new Request("https://function.test", {
      method: "POST", headers: { Authorization: "Bearer user-jwt" },
    }));
    assertEquals(response.status, 403);
    assertEquals(privilegedCalls, []);
    assertEquals(counts(), { callerChecks: 1, cronChecks: 0 });
  });
}

for (const cron of [false, true]) {
  Deno.test(`renewal worker retains ${cron ? "authenticated cron" : "verified admin"} empty-queue execution`, async () => {
    const { handler, privilegedCalls, counts } = fixture(!cron);
    const response = await handler(new Request("https://function.test", { method: "POST",
      headers: cron ? { [CRON_SECRET_HEADER]: "valid-worker-secret" } : { Authorization: "Bearer user-jwt" },
    }));
    assertEquals(response.status, 200);
    assertEquals(privilegedCalls, ["claim_system_job_execution", "claim_credential_renewal_submissions", "finish_system_job"]);
    assertEquals(counts(), { callerChecks: cron ? 0 : 1, cronChecks: cron ? 1 : 0 });
  });
}

Deno.test("renewal worker rejects invalid cron secret without user fallback", async () => {
  const { handler, privilegedCalls, counts } = fixture(true);
  const response = await handler(new Request("https://function.test", { method: "POST",
    headers: { [CRON_SECRET_HEADER]: "invalid", Authorization: "Bearer user-jwt" },
  }));
  assertEquals(response.status, 401);
  assertEquals(privilegedCalls, []);
  assertEquals(counts(), { callerChecks: 0, cronChecks: 1 });
});
