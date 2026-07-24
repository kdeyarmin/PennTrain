import { mapFhirBundle, mapMedicationRequest, referenceId } from "./fhirMapping.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message ?? "assertion failed"}: expected ${expectedJson}, received ${actualJson}`);
  }
}

Deno.test("referenceId strips resource-type and urn prefixes", () => {
  assertEquals(referenceId("Patient/abc"), "abc");
  assertEquals(referenceId("urn:uuid:1234"), "1234");
  assertEquals(referenceId("bare"), "bare");
  assertEquals(referenceId(undefined), null);
  assertEquals(referenceId(""), null);
});

Deno.test("mapMedicationRequest extracts RxNorm, display, dosage, and patient", () => {
  const normalized = mapMedicationRequest({
    resourceType: "MedicationRequest",
    id: "mr1",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/p1" },
    medicationCodeableConcept: {
      coding: [{
        system: "http://www.nlm.nih.gov/research/umls/rxnorm",
        code: "617311",
        display: "Atorvastatin 20 MG",
      }],
      text: "Atorvastatin",
    },
    dosageInstruction: [{ text: "1 tablet nightly" }],
    authoredOn: "2026-07-20T00:00:00Z",
    requester: { display: "Dr. Who" },
  }, "2026-07-25T00:00:00Z");
  assertEquals(normalized.fhirPatientId, "p1");
  assertEquals(normalized.rxnormCode, "617311");
  assertEquals(normalized.medicationDisplay, "Atorvastatin 20 MG");
  assertEquals(normalized.dosageText, "1 tablet nightly");
  assertEquals(normalized.status, "active");
  // No meta.lastUpdated, so sourceUpdatedAt falls back to authoredOn.
  assertEquals(normalized.sourceUpdatedAt, "2026-07-20T00:00:00Z");
});

Deno.test("mapFhirBundle splits requests, administrations, and unsupported resources", () => {
  const bundle = mapFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "MedicationRequest", id: "mr1", subject: { reference: "Patient/p1" } } },
      {
        resource: {
          resourceType: "MedicationAdministration",
          id: "ma1",
          status: "completed",
          subject: { reference: "Patient/p1" },
          request: { reference: "MedicationRequest/mr1" },
          effectiveDateTime: "2026-07-21T10:00:00Z",
        },
      },
      { resource: { resourceType: "Observation", id: "o1" } },
    ],
  }, "2026-07-25T00:00:00Z");
  assertEquals(bundle.medicationRequests.length, 1);
  assertEquals(bundle.medicationAdministrations.length, 1);
  assertEquals(bundle.medicationAdministrations[0].fhirRequestId, "mr1");
  assertEquals(bundle.medicationAdministrations[0].effectiveAt, "2026-07-21T10:00:00Z");
  assertEquals(bundle.unsupported.length, 1);
  assertEquals(bundle.unsupported[0].resourceType, "Observation");
});

Deno.test("mapFhirBundle accepts a single resource outside a Bundle", () => {
  const bundle = mapFhirBundle(
    { resourceType: "MedicationRequest", id: "mr9", subject: { reference: "Patient/p9" } },
    "2026-07-25T00:00:00Z",
  );
  assertEquals(bundle.medicationRequests.length, 1);
  assertEquals(bundle.medicationRequests[0].medicationDisplay, "Unspecified medication");
});
