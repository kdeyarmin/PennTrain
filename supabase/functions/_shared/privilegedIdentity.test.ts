import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireFreshAal2 } from "./privilegedIdentity.ts";

function client(fresh: boolean, error: { message: string } | null = null) {
  return {
    rpc: async () => ({ data: fresh, error }),
  };
}

Deno.test("privileged identity rejects a JWT without current MFA", async () => {
  assertEquals(await requireFreshAal2(client(false)), {
    ok: false, status: 403, error: "Recent multi-factor authentication is required",
  });
});

Deno.test("privileged identity fails closed when assurance cannot be checked", async () => {
  assertEquals(await requireFreshAal2(client(false, { message: "unavailable" })), {
    ok: false, status: 503, error: "Identity assurance could not be verified",
  });
});

Deno.test("privileged identity accepts fresh AAL2", async () => {
  assertEquals(await requireFreshAal2(client(true)), { ok: true });
});
