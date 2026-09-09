import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createFhirIngestHandler } from "./handler.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};
const SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "00000000-0000-4000-8000-000000000002";
const COMMAND_ID = "00000000-0000-4000-8000-000000000003";
const AUTHORIZATION = `Bearer ccb_live_${"a".repeat(12)}.${"b".repeat(64)}`;
const MEDICATION = {
  resourceType: "MedicationRequest", id: "request-1",
  subject: { reference: "Patient/patient-1" }, status: "active", intent: "order",
};

function fixture(allowed = true) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "authenticate_integration_api_credential") {
        return { data: [{ credential_id: CREDENTIAL_ID, rate_limit_per_minute: 60 }], error: null };
      }
      if (name === "consume_integration_rate_limit") {
        return { data: [{ allowed, remaining: 59, reset_at: "2026-09-09T12:01:00Z" }], error: null };
      }
      assertEquals(name, "accept_integration_command");
      return {
        data: [{ command_id: COMMAND_ID, command_status: "accepted", was_duplicate: false,
          correlation_id: args.p_correlation_id }],
        error: null,
      };
    },
  };
  const handler = createFhirIngestHandler({
    createClient: (() => client) as never,
    getEnv: (name) => ENV[name],
  });
  return { handler, calls };
}

function request(rawBody: string, authorization = AUTHORIZATION) {
  return new Request("https://function.test/v1/fhir/bundle", {
    method: "POST",
    headers: { authorization, "content-type": "application/json", "x-fhir-source-id": SOURCE_ID,
      "idempotency-key": "fhir-request-1", "x-correlation-id": "fhir-regression" },
    body: rawBody,
  });
}

for (const body of [null, [], [MEDICATION], "MedicationRequest", 1, false, {}, { resourceType: null }]) {
  Deno.test(`FHIR ingestion rejects invalid resource body ${JSON.stringify(body)}`, async () => {
    const { handler, calls } = fixture();
    const response = await handler(request(JSON.stringify(body)));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: { code: "invalid_fhir_resource" }, meta: { correlationId: "fhir-regression" },
    });
    assertEquals(calls.map(({ name }) => name), [
      "authenticate_integration_api_credential", "consume_integration_rate_limit",
    ]);
  });
}

Deno.test("FHIR ingestion retains malformed JSON response without accepting a command", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request("{"));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "invalid_json");
  assertEquals(calls.length, 2);
});

for (const bundled of [false, true]) {
  Deno.test(`FHIR ingestion accepts a supported ${bundled ? "Bundle" : "single resource"}`, async () => {
    const { handler, calls } = fixture();
    const body = bundled ? { resourceType: "Bundle", entry: [{ resource: MEDICATION }] } : MEDICATION;
    const response = await handler(request(JSON.stringify(body)));
    assertEquals(response.status, 202);
    const result = await response.json();
    assertEquals(result.data.commandId, COMMAND_ID);
    assertEquals(result.data.mapped.medicationRequests, 1);
    const command = calls[2];
    assertEquals(command.name, "accept_integration_command");
    assertEquals(command.args.p_credential_id, CREDENTIAL_ID);
    assertEquals(command.args.p_command_type, "fhir.bundle.import");
    assertEquals(command.args.p_schema_version, "2026-07-25");
    const payload = command.args.p_payload as { sourceId: string; medicationRequests: Array<{ fhirPatientId: string }> };
    assertEquals(payload.sourceId, SOURCE_ID);
    assertEquals(payload.medicationRequests[0].fhirPatientId, "patient-1");
  });
}

Deno.test("FHIR invalid bodies cannot bypass authentication or rate limits", async () => {
  const unauthenticated = fixture();
  const unauthorized = await unauthenticated.handler(request("null", "Bearer invalid"));
  assertEquals(unauthorized.status, 401);
  assertEquals(unauthenticated.calls, []);
  const throttled = fixture(false);
  const limited = await throttled.handler(request("null"));
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error.code, "rate_limit_exceeded");
  assertEquals(throttled.calls.length, 2);
});
