import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createFhirWritebackHandler } from "./handler.ts";

const sourceId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const baseUrl = "https://ehr.example/r4";
const credential = { organizationId, baseUrl, bearerToken: "secret-test-token", contractReference: "APPROVED-VENDOR-1" };
const row = {
  id: "queue-1", source_id: sourceId, organization_id: organizationId, target_url: baseUrl,
  resource_type: "Observation", origin_kind: "clinical_observation", origin_id: "observation-1",
  fhir_payload: { resourceType: "Observation", identifier: [{ system: "https://vendor.example/ids", value: "vendor-id" }] },
};

function fixture(options: { configuration?: string; contract?: string; target?: string; destinationValid?: boolean; providerStatus?: number; persistFailures?: boolean; deny?: boolean; unconfiguredPending?: number } = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const requests: Array<{ url: string; init: any; addresses: string[] | undefined }> = [];
  const admin = {
    rpc: (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "claim_system_job_execution") return Promise.resolve({ data: [{ run_id: "run-1", should_execute: true }], error: null });
      if (name === "claim_fhir_writeback_batch") return Promise.resolve({ data: [{ ...row, target_url: options.target ?? row.target_url }], error: null });
      if (name === "complete_fhir_writeback" && options.persistFailures) return Promise.resolve({ data: null, error: { message: "database unavailable" } });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const result = table === "fhir_integration_sources"
        ? { data: [{ id: sourceId, organization_id: organizationId, fhir_base_url: baseUrl,
          writeback_contract_reference: options.contract ?? credential.contractReference, writeback_conditional_create_confirmed: true }], error: null }
        : { count: 1, data: null, error: null };
      const builder: any = { select: () => builder, in: () => builder, eq: () => builder,
        not: () => { Object.assign(result, { count: options.unconfiguredPending ?? 0 }); return builder; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      return builder;
    },
  };
  const handler = createFhirWritebackHandler({
    createClient: () => admin,
    getEnv: (name) => name === "FHIR_OUTBOUND_AUTH_JSON" ? options.configuration ?? JSON.stringify({ [sourceId]: credential }) : "configured",
    authorizeRequest: () => options.deny ? new Response("Unauthorized", { status: 401 }) : null,
    resolveDestination: async () => options.destinationValid === false
      ? { valid: false, reason: "non_public_address" } : { valid: true, addresses: ["93.184.216.34"] },
    send: async (url, init, addresses) => {
      requests.push({ url, init, addresses });
      const status = options.providerStatus ?? 201;
      return { ok: status < 300, status, text: () => Promise.resolve(JSON.stringify({ id: "vendor-observation-1" })) };
    },
  });
  return { calls, requests, run: () => handler(new Request("https://worker.test/fhir-writeback", { method: "POST", body: "{}" })) };
}

Deno.test("FHIR worker binds the claim and authenticated conditional-create to approved sources", async () => {
  const test = fixture();
  const response = await test.run();
  assertEquals(response.status, 200);
  assertEquals(test.calls.find((call) => call.name === "claim_fhir_writeback_batch")?.args.p_source_ids, [sourceId]);
  assertEquals(test.requests.length, 1);
  const request = test.requests[0];
  assertEquals(request.url, `${baseUrl}/Observation`);
  assertEquals(request.init.headers.Authorization, `Bearer ${credential.bearerToken}`);
  assertStringIncludes(request.init.headers["If-None-Exist"], "|observation-1");
  assertEquals(JSON.parse(request.init.body).identifier.length, 2);
  assertEquals(request.addresses, ["93.184.216.34"]);
  assertEquals(test.calls.find((call) => call.name === "complete_fhir_writeback")?.args.p_success, true);
  assertEquals((await response.text()).includes(credential.bearerToken), false);
});

Deno.test("FHIR worker reports blocked pending sources while delivering an authorized source", async () => {
  const test = fixture({ unconfiguredPending: 3 });
  const response = await test.run();
  assertEquals((await response.json()).unconfiguredPending, 3);
  assertEquals(test.requests.length, 1);
  assertEquals(test.calls.find(call => call.name === "finish_system_job")?.args.p_status, "partial");
});

Deno.test("FHIR worker leaves unconfigured and unapproved queues untouched", async () => {
  for (const options of [{ configuration: "" }, { configuration: "invalid-secret-value" }, { contract: "NOT-CONFIRMED" }]) {
    const test = fixture(options);
    assertEquals((await test.run()).status, 503);
    assertEquals(test.requests.length, 0);
    assertEquals(test.calls.some((call) => call.name === "claim_fhir_writeback_batch"), false);
  }
});

Deno.test("FHIR worker sends no credential or payload to a changed or private destination", async () => {
  for (const options of [{ target: "https://attacker.example/r4" }, { destinationValid: false }]) {
    const test = fixture(options);
    await test.run();
    assertEquals(test.requests.length, 0);
    const completion = test.calls.find((call) => call.name === "complete_fhir_writeback");
    assertEquals(completion?.args.p_success, false);
    assertEquals(completion?.args.p_retryable, false);
  }
});

Deno.test("FHIR worker retries transient provider failures and refuses unauthenticated invocations", async () => {
  const test = fixture({ providerStatus: 503 });
  await test.run();
  assertEquals(test.calls.find((call) => call.name === "complete_fhir_writeback")?.args.p_retryable, true);
  assertEquals(test.calls.find((call) => call.name === "finish_system_job")?.args.p_status, "partial");
  const denied = fixture({ deny: true });
  assertEquals((await denied.run()).status, 401);
  assertEquals(denied.calls.length, 0);
  assertEquals(denied.requests.length, 0);
});
