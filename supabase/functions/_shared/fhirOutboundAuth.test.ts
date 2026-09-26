import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { authorizeFhirOutboundRow, fhirOutboundCredentialMatches, parseFhirOutboundCredentials } from "./fhirOutboundAuth.ts";
const sourceId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const secret = { organizationId, baseUrl: "https://ehr.example/fhir/r4/", bearerToken: "private-example-token", contractReference: "VENDOR-CONTRACT-1" };
const configuration = () => parseFhirOutboundCredentials(JSON.stringify({ [sourceId]: secret }));
const row = { source_id: sourceId, organization_id: organizationId, target_url: "https://ehr.example/fhir/r4", resource_type: "Observation" };

Deno.test("outbound FHIR authorization is source, tenant, endpoint-path and resource bound", () => {
  assertEquals(authorizeFhirOutboundRow(configuration(), row), `Bearer ${secret.bearerToken}`);
  for (const override of [{ source_id: organizationId }, { organization_id: sourceId }, { target_url: "https://ehr.example/another-tenant" }, { target_url: "https://attacker.example/fhir/r4" }, { resource_type: "Patient" }]) {
    assertThrows(() => authorizeFhirOutboundRow(configuration(), { ...row, ...override }), TypeError, "does not match");
  }
});

Deno.test("outbound FHIR requires contract and conditional-create confirmation", () => {
  const credential = configuration().get(sourceId);
  const source = { organization_id: organizationId, fhir_base_url: row.target_url, writeback_contract_reference: secret.contractReference, writeback_conditional_create_confirmed: true };
  assertEquals(fhirOutboundCredentialMatches(credential, source), true);
  assertEquals(fhirOutboundCredentialMatches(credential, { ...source, writeback_conditional_create_confirmed: false }), false);
  assertEquals(fhirOutboundCredentialMatches(credential, { ...source, writeback_contract_reference: "different-contract" }), false);
});

Deno.test("outbound FHIR rejects malformed configuration without disclosing secrets", () => {
  assertEquals(parseFhirOutboundCredentials(undefined).size, 0);
  for (const raw of ["private-example-token", "null", "[]", JSON.stringify({ [sourceId]: { ...secret, bearerToken: "secret\r\nX-Leak: yes" } }), JSON.stringify({ [sourceId]: { ...secret, baseUrl: "https://user:private-example-token@ehr.example" } })]) {
    const error = assertThrows(() => parseFhirOutboundCredentials(raw), Error, "credentials are invalid");
    assertEquals(error.message.includes("private-example-token"), false);
  }
});
