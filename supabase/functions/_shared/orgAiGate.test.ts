import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  ORG_AI_DISABLED_CODE,
  ORG_AI_DISABLED_MESSAGE,
  orgAiAllowed,
  orgAiDisabledBody,
  orgAiGateDecision,
} from "./orgAiGate.ts";

// No Deno.env use anywhere: these tests must run under scripts/check-edge-functions.mjs,
// which invokes `deno test` without --allow-env.

const ORG = "0f9f2a51-8cc5-4bcd-9f39-2f1c6a54b0aa";

Deno.test("no organization context bypasses the org gate (platform-level work)", () => {
  assertEquals(orgAiGateDecision(null, null), "allow");
  assertEquals(orgAiGateDecision(undefined, { data: false, error: null }), "allow");
  assertEquals(orgAiGateDecision("", { data: false, error: null }), "allow");
});

Deno.test("an org in scope requires an errorless true from the RPC", () => {
  assertEquals(orgAiGateDecision(ORG, { data: true, error: null }), "allow");
  assertEquals(orgAiGateDecision(ORG, { data: false, error: null }), "deny");
});

Deno.test("fails closed on RPC errors, missing results, and non-boolean payloads", () => {
  assertEquals(orgAiGateDecision(ORG, null), "deny");
  assertEquals(orgAiGateDecision(ORG, undefined), "deny");
  assertEquals(orgAiGateDecision(ORG, { data: null, error: null }), "deny");
  assertEquals(orgAiGateDecision(ORG, { data: "true", error: null }), "deny");
  assertEquals(
    orgAiGateDecision(ORG, { data: true, error: { message: "boom" } }),
    "deny",
  );
});

Deno.test("denied body keeps the { error } envelope and carries the stable code", () => {
  const body = orgAiDisabledBody();
  assertEquals(body.error, ORG_AI_DISABLED_MESSAGE);
  assertEquals(body.code, ORG_AI_DISABLED_CODE);
  assertEquals(ORG_AI_DISABLED_CODE, "org_ai_disabled");
});

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
}

Deno.test("orgAiAllowed calls public.org_ai_allowed with the org id and honors the result", async () => {
  const allowed = fakeClient({ data: true, error: null });
  assertEquals(await orgAiAllowed(allowed, ORG), true);
  assertEquals(allowed.calls, [{ fn: "org_ai_allowed", args: { p_org: ORG } }]);

  const denied = fakeClient({ data: false, error: null });
  assertEquals(await orgAiAllowed(denied, ORG), false);
});

Deno.test("orgAiAllowed skips the RPC entirely without an org id", async () => {
  const client = fakeClient({ data: false, error: null });
  assertEquals(await orgAiAllowed(client, null), true);
  assertEquals(await orgAiAllowed(client, undefined), true);
  assertEquals(client.calls.length, 0);
});

Deno.test("orgAiAllowed fails closed when the RPC itself throws", async () => {
  const throwing = {
    rpc(): Promise<{ data: unknown; error: { message: string } | null }> {
      return Promise.reject(new Error("network down"));
    },
  };
  assertEquals(await orgAiAllowed(throwing, ORG), false);
});
