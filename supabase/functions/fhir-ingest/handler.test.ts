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

for (const body of [
  { resourceType: "Bundle", entry: {} },
  { resourceType: "Bundle", entry: [null] },
  { resourceType: "Bundle", entry: [{ resource: [] }] },
  { resourceType: "Bundle", entry: [{ fullUrl: {}, resource: MEDICATION }] },
  { ...MEDICATION, subject: { reference: 123 } },
  { ...MEDICATION, medicationCodeableConcept: { coding: {} } },
  { ...MEDICATION, medicationCodeableConcept: { coding: [null] } },
  { ...MEDICATION, medicationCodeableConcept: { coding: [{ system: 123 }] } },
  { ...MEDICATION, dosageInstruction: { text: "invalid array" } },
  { resourceType: "AllergyIntolerance", id: "allergy-1", category: "medication" },
  { resourceType: "AllergyIntolerance", id: "allergy-1", reaction: [null] },
  { resourceType: "AllergyIntolerance", id: "allergy-1", reaction: [{ manifestation: {} }] },
  { resourceType: "Condition", id: "condition-1", category: [{ coding: [null] }] },
]) {
  Deno.test(`FHIR ingestion rejects malformed nested structure ${JSON.stringify(body)}`, async () => {
    const { handler, calls } = fixture();
    const response = await handler(request(JSON.stringify(body)));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: { code: "invalid_fhir_resource" }, meta: { correlationId: "fhir-regression" },
    });
    assertEquals(calls.length, 2);
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

Deno.test("FHIR bundles with wrong-shaped nested fields answer inside the error envelope", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(JSON.stringify({ resourceType: "Bundle", entry: {} })));
  assertEquals(response.status, 422);
  assertEquals((await response.json()).error.code, "no_supported_resources");
  assertEquals(calls.length, 2);

  const tolerated = await fixture().handler(request(JSON.stringify({
    resourceType: "AllergyIntolerance",
    id: "a1",
    category: "food",
    reaction: {},
    code: { coding: "abc" },
    patient: { reference: "Patient/patient-1" },
  })));
  assertEquals(tolerated.status, 202);
});
Deno.test("FHIR ingestion preserves patient and order identity for version-specific medication references", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(JSON.stringify({
    resourceType: "MedicationAdministration", id: "event-1", status: "completed",
    subject: { reference: "https://ehr.example/fhir/Patient/patient-1/_history/7" },
    request: { reference: "MedicationRequest/order-1/_history/9" },
    effectiveDateTime: "2026-09-15T00:00:00-04:00",
  })));
  assertEquals(response.status, 202);
  const payload = calls[2].args.p_payload as { medicationAdministrations: Array<Record<string, unknown>> };
  assertEquals(payload.medicationAdministrations[0].fhirPatientId, "patient-1");
  assertEquals(payload.medicationAdministrations[0].fhirRequestId, "order-1");
  assertEquals(payload.medicationAdministrations[0].effectiveAt, "2026-09-15T00:00:00-04:00");
});

Deno.test("FHIR ingestion leaves Group medication evidence unmatched rather than selecting a resident with the same ID", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(JSON.stringify({
    ...MEDICATION, subject: { reference: "Group/patient-1" },
  })));
  assertEquals(response.status, 202);
  const payload = calls[2].args.p_payload as { medicationRequests: Array<Record<string, unknown>> };
  // apply_fhir_integration_command routes a null patient ID to its unmatched_patient exception;
  // it must not see 'patient-1' and attach a group order to that resident's chart.
  assertEquals(payload.medicationRequests[0].fhirPatientId, null);
});

Deno.test("FHIR shape validation preserves all supported resources and unknown extension data", async () => {
  const { handler, calls } = fixture();
  const subject = { reference: "Patient/patient-1" };
  const code = { coding: [{ system: "http://snomed.info/sct", code: "test-code", display: "Test fixture" }] };
  const extension = [{ url: "https://ehr.example/extension", valueString: "preserved" }];
  const response = await handler(request(JSON.stringify({
    resourceType: "Bundle", entry: [
      { resource: { ...MEDICATION, medicationCodeableConcept: code, dosageInstruction: [{ text: "Fixture only" }], extension } },
      { resource: { resourceType: "MedicationAdministration", id: "event-1", subject,
        effectivePeriod: { start: "2026-09-15T00:00:00Z" }, performer: [{ actor: { display: "Fixture staff" } }] } },
      { resource: { resourceType: "AllergyIntolerance", id: "allergy-1", patient: subject, code,
        category: ["medication"], reaction: [{ manifestation: [code] }] } },
      { resource: { resourceType: "Condition", id: "condition-1", subject, code, category: [code] } },
      { resource: { resourceType: "ServiceRequest", id: "service-1", subject, code } },
      { resource: { resourceType: "DocumentReference", id: "document-1", subject, type: code,
        content: [{ attachment: { url: "https://ehr.example/doc", contentType: "application/pdf" } }] } },
      { resource: { resourceType: "Observation", id: "unsupported-1" } },
    ],
  })));
  assertEquals(response.status, 202);
  assertEquals((await response.json()).data.mapped, {
    medicationRequests: 1, medicationAdministrations: 1, allergies: 1,
    conditions: 1, serviceRequests: 1, documentReferences: 1, unsupported: 1,
  });
  const payload = calls[2].args.p_payload as { medicationRequests: Array<{ raw: Record<string, unknown> }> };
  assertEquals(payload.medicationRequests[0].raw.extension, extension);
});

Deno.test("FHIR repeating primitive placeholders retain their metadata without inventing allergy categories", async () => {
  const { handler, calls } = fixture();
  const categoryMetadata = [{ extension: [{
    url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason", valueCode: "unknown",
  }] }, null];
  const response = await handler(request(JSON.stringify({
    resourceType: "AllergyIntolerance", id: "allergy-1",
    patient: { reference: "Patient/patient-1" }, category: [null, "medication"],
    _category: categoryMetadata,
  })));
  assertEquals(response.status, 202);
  const payload = calls[2].args.p_payload as { allergies: Array<{ category: string[]; raw: Record<string, unknown> }> };
  assertEquals(payload.allergies[0].category, ["medication"]);
  assertEquals(payload.allergies[0].raw._category, categoryMetadata);
});

for (const targetType of ["Patient", "Group"]) {
  Deno.test(`FHIR ingestion resolves UUID aliases against actual ${targetType} targets before resident matching`, async () => {
    const { handler, calls } = fixture();
    const fullUrl = "urn:uuid:10000000-0000-4000-8000-000000000001";
    const response = await handler(request(JSON.stringify({
      resourceType: "Bundle", entry: [
        { fullUrl, resource: { resourceType: targetType, id: "patient-1" } },
        { resource: { ...MEDICATION, subject: { reference: fullUrl } } },
      ],
    })));
    assertEquals(response.status, 202);
    const payload = calls[2].args.p_payload as { medicationRequests: Array<Record<string, unknown>> };
    assertEquals(payload.medicationRequests[0].fhirPatientId, targetType === "Patient" ? "patient-1" : null);
  });
}
