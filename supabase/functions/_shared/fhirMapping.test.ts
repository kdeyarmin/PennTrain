import {
  mapAllergyIntolerance,
  mapCondition,
  mapFhirBundle,
  mapMedicationAdministration,
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

Deno.test("version-specific references resolve the resource ID, never the version ID", () => {
  assertEquals(referenceId("Patient/patient-1/_history/7"), "patient-1");
  assertEquals(referenceId("https://ehr.example/fhir/Patient/patient-1/_history/7"), "patient-1");
  const administration = mapMedicationAdministration({
    id: "administration-1",
    subject: { reference: "Patient/patient-1/_history/7" },
    request: { reference: "MedicationRequest/order-1/_history/9" },
  });
  assertEquals(administration.fhirPatientId, "patient-1");
  assertEquals(administration.fhirRequestId, "order-1");
});

Deno.test("non-patient subjects cannot collide with resident patient mappings", () => {
  for (const reference of ["Group/patient-1", "https://ehr.example/Group/patient-1/_history/7"]) {
    const bundle = mapFhirBundle({
      resourceType: "Bundle",
      entry: [
        { resource: { resourceType: "MedicationRequest", id: "order", subject: { reference } } },
        { resource: { resourceType: "MedicationAdministration", id: "event", subject: { reference } } },
        { resource: { resourceType: "AllergyIntolerance", id: "allergy", patient: { reference } } },
        { resource: { resourceType: "Condition", id: "condition", subject: { reference } } },
        { resource: { resourceType: "ServiceRequest", id: "service", subject: { reference } } },
        { resource: { resourceType: "DocumentReference", id: "document", subject: { reference } } },
      ],
    }, "2026-09-15T00:00:00Z");
    assertEquals([
      ...bundle.medicationRequests, ...bundle.medicationAdministrations, ...bundle.allergies,
      ...bundle.conditions, ...bundle.serviceRequests, ...bundle.documentReferences,
    ].map((row) => row.fhirPatientId), [null, null, null, null, null, null]);
  }
});

Deno.test("malformed and contained references cannot become a resident identifier", () => {
  for (const reference of ["Patient/p1/_history", "Patient/p1/", "Patient/p1?x=1", "#p1", "urn:uuid:"]) {
    assertEquals(referenceId(reference), null, reference);
  }
});

Deno.test("explicit reference types cannot disguise a non-patient or unrelated order", () => {
  assertEquals(mapMedicationAdministration({
    subject: { reference: "urn:uuid:patient-1", type: "Group" },
    request: { reference: "ServiceRequest/order-1" },
  }).fhirPatientId, null);
  const administration = mapMedicationAdministration({
    subject: { reference: "Patient/patient-1", type: "Patient" },
    request: { reference: "ServiceRequest/order-1" },
  });
  assertEquals(administration.fhirPatientId, "patient-1");
  assertEquals(administration.fhirRequestId, null);
});

Deno.test("unresolved UUID references need an explicit type before matching resident or order IDs", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  assertEquals(mapMedicationAdministration({
    subject: { reference: `urn:uuid:${id}` }, request: { reference: `urn:uuid:${id}` },
  }).fhirPatientId, null);
  assertEquals(mapMedicationAdministration({ request: { reference: `urn:uuid:${id}` } }).fhirRequestId, null);
  assertEquals(mapMedicationAdministration({ subject: { reference: `urn:uuid:${id}`, type: "Patient" } }).fhirPatientId, id);
});

Deno.test("UUID Bundle aliases resolve actual Patient and MedicationRequest identity", () => {
  const patientUrl = "urn:uuid:10000000-0000-4000-8000-000000000001";
  const orderUrl = "urn:uuid:10000000-0000-4000-8000-000000000002";
  const bundle = mapFhirBundle({ resourceType: "Bundle", entry: [
    { fullUrl: patientUrl, resource: { resourceType: "Patient", id: "patient-1" } },
    { fullUrl: orderUrl, resource: { resourceType: "MedicationRequest", id: "order-1", subject: { reference: patientUrl } } },
    { resource: { resourceType: "MedicationAdministration", id: "event-1",
      subject: { reference: patientUrl }, request: { reference: orderUrl } } },
  ] }, "2026-09-15T00:00:00Z");
  assertEquals(bundle.medicationRequests[0].fhirPatientId, "patient-1");
  assertEquals(bundle.medicationAdministrations[0].fhirPatientId, "patient-1");
  assertEquals(bundle.medicationAdministrations[0].fhirRequestId, "order-1");
  assertEquals(bundle.medicationAdministrations[0].raw.subject?.reference, patientUrl);
});

Deno.test("Bundle Group UUIDs cannot select a resident even when Reference.type claims Patient", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  for (const type of [undefined, "Patient"]) {
    const subject = { reference: `urn:uuid:${id}`, ...(type ? { type } : {}) };
    const bundle = mapFhirBundle({ resourceType: "Bundle", entry: [
      { fullUrl: subject.reference, resource: { resourceType: "Group", id } },
      { resource: { resourceType: "MedicationRequest", id: "order", subject } },
      { resource: { resourceType: "MedicationAdministration", id: "event", subject } },
      { resource: { resourceType: "AllergyIntolerance", id: "allergy", patient: subject } },
      { resource: { resourceType: "Condition", id: "condition", subject } },
      { resource: { resourceType: "ServiceRequest", id: "service", subject } },
      { resource: { resourceType: "DocumentReference", id: "document", subject } },
    ] }, "2026-09-15T00:00:00Z");
    assertEquals([
      ...bundle.medicationRequests, ...bundle.medicationAdministrations, ...bundle.allergies,
      ...bundle.conditions, ...bundle.serviceRequests, ...bundle.documentReferences,
    ].map((row) => row.fhirPatientId), [null, null, null, null, null, null]);
  }
});

Deno.test("duplicate Bundle fullUrls stay unmatched instead of selecting whichever resident comes first", () => {
  const fullUrl = "urn:uuid:10000000-0000-4000-8000-000000000001";
  const patients = ["patient-1", "patient-2"];
  for (const ids of [patients, [...patients].reverse()]) {
    const bundle = mapFhirBundle({ resourceType: "Bundle", entry: [
      ...ids.map((id) => ({ fullUrl, resource: { resourceType: "Patient", id } })),
      { resource: { resourceType: "MedicationRequest", id: "order", subject: { reference: fullUrl, type: "Patient" } } },
    ] }, "2026-09-15T00:00:00Z");
    assertEquals(bundle.medicationRequests[0].fhirPatientId, null);
  }
});

Deno.test("UUID fallback needs a resolved Patient without an ID, never a malformed logical ID", () => {
  const id = "10000000-0000-4000-8000-000000000001", fullUrl = `urn:uuid:${id}`;
  for (const targetId of [undefined, "", "invalid/id"]) {
    const bundle = mapFhirBundle({ resourceType: "Bundle", entry: [
      { fullUrl, resource: { resourceType: "Patient", ...(targetId === undefined ? {} : { id: targetId }) } },
      { resource: { resourceType: "MedicationRequest", id: "order", subject: { reference: fullUrl } } },
    ] }, "2026-09-15T00:00:00Z");
    assertEquals(bundle.medicationRequests[0].fhirPatientId, targetId === undefined ? id : null);
  }
});

Deno.test("Bundle aliases cannot turn contained or malformed references into external patient IDs", () => {
  for (const fullUrl of ["#contained", "https://example.test/Patient/patient-1?version=1", "Patient\\patient-1", "urn:uuid:invalid id"]) {
    const bundle = mapFhirBundle({ resourceType: "Bundle", entry: [
      { fullUrl, resource: { resourceType: "Patient", id: "patient-1" } },
      { resource: { resourceType: "MedicationRequest", id: "order", subject: { reference: fullUrl } } },
    ] }, "2026-09-15T00:00:00Z");
    assertEquals(bundle.medicationRequests[0].fhirPatientId, null);
  }
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

Deno.test("wrong-shaped nested FHIR fields map as empty instead of throwing", () => {
  const bundle = mapFhirBundle({ resourceType: "Bundle", entry: {} } as unknown as Parameters<typeof mapFhirBundle>[0], "2026-09-25T00:00:00.000Z");
  assertEquals(bundle.medicationRequests.length + bundle.allergies.length + bundle.unsupported.length, 0);

  const allergy = mapAllergyIntolerance({
    resourceType: "AllergyIntolerance",
    id: "a1",
    category: "food",
    reaction: {},
    code: { coding: "abc" },
    patient: { reference: 123 },
  } as unknown as Parameters<typeof mapAllergyIntolerance>[0], "2026-09-25T00:00:00.000Z");
  assertEquals(allergy.category, null);
  assertEquals(allergy.reactionManifestations, null);
  assertEquals(allergy.fhirPatientId, null);
  assertEquals(referenceId(123 as unknown as string), null);
});
