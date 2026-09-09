import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireSmsMfaFloor } from "./smsMfaFloor.ts";

for (const [label, data, error, status] of [
  ["current SMS or account without SMS", true, null, 200],
  ["missing SMS proof", false, null, 403],
  ["missing response", null, null, 403],
  ["truthy malformed response", "true", null, 403],
  ["pre-request rejection", null, { code: "42501", hint: "mfa_required" }, 403],
  ["database unavailable", null, { message: "private details" }, 503],
] as const) {
  Deno.test(`SMS edge floor: ${label}`, async () => {
    const result = await requireSmsMfaFloor({ rpc: async (name, args) => {
      assertEquals(name, "current_sms_mfa_satisfied");
      assertEquals(args, {});
      return { data, error };
    } });
    assertEquals(result.ok ? 200 : result.status, status);
    assertEquals(JSON.stringify(result).includes("private details"), false);
  });
}

Deno.test("SMS edge floor fails closed on transport exception", async () => {
  const result = await requireSmsMfaFloor({ rpc: () => { throw new Error("provider private error"); } });
  assertEquals(result.ok ? 200 : result.status, 503);
  assertEquals(JSON.stringify(result).includes("provider private error"), false);
});
