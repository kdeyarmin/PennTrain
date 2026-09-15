// Validate only the JSON shapes the boundary mapper consumes. This is not full FHIR clinical
// validation: required clinical fields, enumerations, and mapped resident scope remain checked by
// the command applier. Unknown fields/extensions are preserved in the original resource.

type Shape = "string" | "primitive-array-string" | { [key: string]: Shape } | [Shape];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesShape(value: unknown, shape: Shape): boolean {
  if (shape === "string") return typeof value === "string";
  // FHIR repeating primitives may use null placeholders aligned with their underscore metadata.
  // The allergy mapper already filters these absent values; the raw resource keeps the metadata.
  // https://hl7.org/fhir/R4/json.html#primitive
  if (shape === "primitive-array-string") return value === null || typeof value === "string";
  if (Array.isArray(shape)) return Array.isArray(value) && value.every((item) => matchesShape(item, shape[0]));
  return isObject(value) && Object.entries(shape).every(([key, child]) =>
    value[key] === undefined || matchesShape(value[key], child)
  );
}

const reference: Shape = { reference: "string", type: "string", display: "string" };
const concept: Shape = { text: "string", coding: [{ system: "string", code: "string", display: "string" }] };
const period: Shape = { start: "string" };
const common = { id: "string", meta: { lastUpdated: "string" } } satisfies Record<string, Shape>;
const resourceShapes: Record<string, Shape> = {
  MedicationRequest: {
    ...common, subject: reference, status: "string", intent: "string", authoredOn: "string",
    requester: reference, medicationCodeableConcept: concept, medicationReference: reference,
    dosageInstruction: [{ text: "string" }],
  },
  MedicationAdministration: {
    ...common, subject: reference, request: reference, status: "string",
    medicationCodeableConcept: concept, medicationReference: reference,
    effectiveDateTime: "string", occurrenceDateTime: "string", effectivePeriod: period,
    occurrencePeriod: period, performer: [{ actor: reference }],
  },
  AllergyIntolerance: {
    ...common, patient: reference, subject: reference, code: concept, clinicalStatus: concept,
    verificationStatus: concept, criticality: "string", category: ["primitive-array-string"],
    reaction: [{ manifestation: [concept] }], recordedDate: "string",
  },
  Condition: {
    ...common, subject: reference, code: concept, clinicalStatus: concept, verificationStatus: concept,
    category: [concept], onsetDateTime: "string", onsetPeriod: period, abatementDateTime: "string",
    recordedDate: "string",
  },
  ServiceRequest: {
    ...common, subject: reference, code: concept, status: "string", intent: "string",
    priority: "string", authoredOn: "string", requester: reference,
  },
  DocumentReference: {
    ...common, subject: reference, type: concept, status: "string",
    content: [{ attachment: { url: "string", contentType: "string" } }], context: { period },
  },
};

function validResource(value: unknown): boolean {
  if (!isObject(value) || typeof value.resourceType !== "string") return false;
  const shape = Object.hasOwn(resourceShapes, value.resourceType) ? resourceShapes[value.resourceType] : common;
  return matchesShape(value, shape);
}

export function hasValidFhirMappingShape(value: unknown): boolean {
  if (!isObject(value) || typeof value.resourceType !== "string") return false;
  if (value.resourceType !== "Bundle") return validResource(value);
  if (value.entry === undefined) return true;
  return Array.isArray(value.entry) && value.entry.every((entry) =>
    isObject(entry) && (entry.fullUrl === undefined || typeof entry.fullUrl === "string") &&
    (entry.resource === undefined || validResource(entry.resource))
  );
}
