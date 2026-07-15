import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireFreshAal2 } from "./privilegedIdentity.ts";

function client(level: string, fresh: boolean) {
  return {
    auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({
      data: { currentLevel: level, nextLevel: level }, error: null,
    }) } },
    rpc: async () => ({ data: fresh, error: null }),
  };
}

Deno.test("privileged identity rejects AAL1", async () => {
  assertEquals(await requireFreshAal2(client("aal1", true)), {
    ok: false, status: 403, error: "Recent multi-factor authentication is required",
  });
});

Deno.test("privileged identity rejects stale AAL2", async () => {
  assertEquals(await requireFreshAal2(client("aal2", false)), {
    ok: false, status: 403, error: "Multi-factor authentication is no longer recent",
  });
});

Deno.test("privileged identity accepts fresh AAL2", async () => {
  assertEquals(await requireFreshAal2(client("aal2", true)), { ok: true });
});
