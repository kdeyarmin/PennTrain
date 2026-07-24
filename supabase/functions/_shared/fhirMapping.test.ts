import {
  mapAllergyIntolerance,
  mapCondition,
  mapFhirBundle,
  mapMedicationRequest,
  referenceId,
} from "./fhirMapping.ts";

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

Deno.test("mapMedicationRequest falls back to medicationReference display", () => {
  const normalized = mapMedicationRequest({
    resourceType: "MedicationRequest",
    id: "mr2",
    status: "active",
    subject: { reference: "Patient/p1" },
    medicationReference: { reference: "Medication/med-1", display: "Lisinopril 10 MG Oral Tablet" },
  }, "2026-07-25T00:00:00Z");
  assertEquals(normalized.rxnormCode, null);
  assertEquals(normalized.medicationDisplay, "Lisinopril 10 MG Oral Tablet");
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

Deno.test("mapAllergyIntolerance uses patient reference and extracts status/criticality", () => {
  const allergy = mapAllergyIntolerance({
    resourceType: "AllergyIntolerance",
    id: "al1",
    patient: { reference: "Patient/p1" },
    code: { coding: [{ system: "http://snomed.info/sct", code: "373270004", display: "Penicillin" }] },
    clinicalStatus: { coding: [{ code: "active" }] },
    verificationStatus: { coding: [{ code: "confirmed" }] },
    criticality: "high",
    category: ["medication"],
    reaction: [{ manifestation: [{ text: "Hives" }] }],
  }, "2026-07-25T00:00:00Z");
  assertEquals(allergy.fhirPatientId, "p1");
  assertEquals(allergy.substanceDisplay, "Penicillin");
  assertEquals(allergy.substanceSystem, "snomed");
  assertEquals(allergy.clinicalStatus, "active");
  assertEquals(allergy.criticality, "high");
  assertEquals(allergy.category, ["medication"]);
  assertEquals(allergy.reactionManifestations, ["Hives"]);
});

Deno.test("mapCondition extracts coded diagnosis and clinical status", () => {
  const condition = mapCondition({
    resourceType: "Condition",
    id: "c1",
    subject: { reference: "Patient/p1" },
    code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "E11.9", display: "Type 2 diabetes mellitus" }] },
    clinicalStatus: { coding: [{ code: "active" }] },
    category: [{ coding: [{ code: "problem-list-item" }] }],
    onsetDateTime: "2025-01-01T00:00:00Z",
  }, "2026-07-25T00:00:00Z");
  assertEquals(condition.codeDisplay, "Type 2 diabetes mellitus");
  assertEquals(condition.code, "E11.9");
  assertEquals(condition.codeSystem, "icd10cm");
  assertEquals(condition.clinicalStatus, "active");
  assertEquals(condition.category, "problem-list-item");
});

Deno.test("mapFhirBundle routes allergies, conditions, orders, and documents", () => {
  const bundle = mapFhirBundle({
    resourceType: "Bundle",
    entry: [
      { resource: { resourceType: "AllergyIntolerance", id: "al1", patient: { reference: "Patient/p1" }, code: { text: "Peanut" } } },
      { resource: { resourceType: "Condition", id: "c1", subject: { reference: "Patient/p1" }, code: { text: "Hypertension" } } },
      { resource: { resourceType: "ServiceRequest", id: "s1", subject: { reference: "Patient/p1" }, code: { text: "PT eval" }, status: "active" } },
      { resource: { resourceType: "DocumentReference", id: "d1", subject: { reference: "Patient/p1" }, type: { text: "H&P" }, status: "current" } },
    ],
  }, "2026-07-25T00:00:00Z");
  assertEquals(bundle.allergies.length, 1);
  assertEquals(bundle.conditions.length, 1);
  assertEquals(bundle.serviceRequests.length, 1);
  assertEquals(bundle.documentReferences.length, 1);
  assertEquals(bundle.unsupported.length, 0);
});
