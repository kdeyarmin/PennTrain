// Pure FHIR R4 -> normalized boundary-record mappers for the clinical ingestion boundary.
// The fhir-ingest edge function calls these to turn an inbound Bundle (or single resource)
// into the normalized payload that public.apply_fhir_integration_command drains into the
// fhir_* tables. No database or network access -- fully unit-testable.

import { classifyCodeSystem, type CodeableConcept, conceptDisplay, findCoding } from "./fhirTerminology.ts";

interface Reference {
  reference?: string;
  type?: string;
  display?: string;
}

interface FhirResource {
  resourceType?: string;
  id?: string;
  status?: string;
  docStatus?: string;
  intent?: string;
  priority?: string;
  subject?: Reference;
  patient?: Reference;
  request?: Reference;
  authoredOn?: string;
  requester?: Reference;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  code?: CodeableConcept;
  type?: CodeableConcept;
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  criticality?: string;
  category?: unknown[];
  reaction?: { manifestation?: CodeableConcept[] }[];
  dosageInstruction?: { text?: string }[];
  effectiveDateTime?: string;
  effectivePeriod?: { start?: string };
  occurrenceDateTime?: string;
  occurrencePeriod?: { start?: string };
  onsetDateTime?: string;
  onsetPeriod?: { start?: string };
  abatementDateTime?: string;
  recordedDate?: string;
  performer?: { actor?: Reference }[];
  content?: { attachment?: { url?: string; contentType?: string } }[];
  context?: { period?: { start?: string } };
  meta?: { lastUpdated?: string };
}

interface FhirBundle {
  resourceType?: string;
  entry?: { fullUrl?: string; resource?: FhirResource }[];
}

type ReferenceTargets = ReadonlyMap<string, FhirResource | null>;
const FHIR_ID = /^[A-Za-z0-9.-]{1,64}$/;

export interface NormalizedMedicationRequest {
  fhirPatientId: string | null;
  fhirResourceId: string;
  rxnormCode: string | null;
  medicationDisplay: string;
  dosageText: string | null;
  status: string;
  intent: string | null;
  authoredOn: string | null;
  requesterDisplay: string | null;
  sourceUpdatedAt: string;
  raw: FhirResource;
}

export interface NormalizedMedicationAdministration {
  fhirPatientId: string | null;
  fhirResourceId: string;
  fhirRequestId: string | null;
  status: string;
  medicationDisplay: string | null;
  effectiveAt: string | null;
  performerDisplay: string | null;
  raw: FhirResource;
}

export interface NormalizedAllergy {
  fhirPatientId: string | null;
  fhirResourceId: string;
  substanceDisplay: string;
  substanceCode: string | null;
  substanceSystem: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  criticality: string | null;
  category: string[] | null;
  reactionManifestations: string[] | null;
  recordedDate: string | null;
  sourceUpdatedAt: string;
  raw: FhirResource;
}

export interface NormalizedCondition {
  fhirPatientId: string | null;
  fhirResourceId: string;
  codeDisplay: string;
  code: string | null;
  codeSystem: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  category: string | null;
  onsetDate: string | null;
  abatementDate: string | null;
  recordedDate: string | null;
  sourceUpdatedAt: string;
  raw: FhirResource;
}

export interface NormalizedServiceRequest {
  fhirPatientId: string | null;
  fhirResourceId: string;
  codeDisplay: string;
  code: string | null;
  codeSystem: string | null;
  status: string;
  intent: string | null;
  priority: string | null;
  authoredOn: string | null;
  requesterDisplay: string | null;
  sourceUpdatedAt: string;
  raw: FhirResource;
}

export interface NormalizedDocumentReference {
  fhirPatientId: string | null;
  fhirResourceId: string;
  typeDisplay: string | null;
  typeCode: string | null;
  status: string | null;
  contentUrl: string | null;
  contentType: string | null;
  contextStart: string | null;
  sourceUpdatedAt: string;
  raw: FhirResource;
}

export interface NormalizedFhirBundle {
  medicationRequests: NormalizedMedicationRequest[];
  medicationAdministrations: NormalizedMedicationAdministration[];
  allergies: NormalizedAllergy[];
  conditions: NormalizedCondition[];
  serviceRequests: NormalizedServiceRequest[];
  documentReferences: NormalizedDocumentReference[];
  unsupported: { resourceType: string; id: string | null }[];
}

/**
 * Resolve the logical resource ID, including FHIR R4 version-specific references.
 * The database matches this against a source-scoped patient mapping; returning the final path
 * segment would match a version number (or a Group ID) to an unrelated resident.
 * https://hl7.org/fhir/R4/references.html#literal
 */
export function referenceId(reference: string | undefined | null, expectedType?: string): string | null {
  if (typeof reference !== "string") return null;
  const trimmed = reference.trim();
  if (trimmed === "" || /[\s\\?#]/.test(trimmed)) return null;
  // This generic extractor can return a UUID suffix, but a UUID cannot prove an expected type.
  // resourceReferenceId first resolves its Bundle target or requires an explicit Reference.type.
  if (trimmed.startsWith("urn:uuid:")) {
    const id = trimmed.slice("urn:uuid:".length);
    return !expectedType && FHIR_ID.test(id) ? id : null;
  }
  if (FHIR_ID.test(trimmed)) return trimmed;
  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.username || url.password) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  } else if (!/^[A-Za-z][A-Za-z0-9]*\/[A-Za-z0-9.-]+(?:\/_history\/[A-Za-z0-9.-]+)?$/.test(trimmed)) {
    return null;
  }
  const match = path.match(/(?:^|\/)([A-Za-z][A-Za-z0-9]*)\/([A-Za-z0-9.-]{1,64})(?:\/_history\/[A-Za-z0-9.-]{1,64})?$/);
  if (!match || (expectedType && match[1] !== expectedType)) return null;
  return match[2];
}

function resourceReferenceId(reference: Reference | undefined, expectedType: string, targets?: ReferenceTargets): string | null {
  if (reference?.type && reference.type !== expectedType &&
    reference.type !== `http://hl7.org/fhir/StructureDefinition/${expectedType}`) return null;
  const literal = reference?.reference?.trim();
  if (!literal || /[\s\\?#]/.test(literal)) return null;
  if (targets?.has(literal)) {
    const target = targets.get(literal);
    // Duplicate fullUrls are ambiguous; a claimed Reference.type cannot override a Group target.
    if (!target || target.resourceType !== expectedType) return null;
    if (target.id !== undefined) return FHIR_ID.test(target.id) ? target.id : null;
    // Preserve UUID-based partner mappings only after resolving an actual target of the right
    // type. This fallback is a boundary compatibility contract for resources lacking a logical ID.
    return referenceId(literal);
  }
  if (literal.startsWith("urn:uuid:")) return reference?.type ? referenceId(literal) : null;
  return referenceId(literal, expectedType);
}

function firstCoding(concept: CodeableConcept | undefined) {
  return concept?.coding?.[0] ?? null;
}

/** Code from a status/category CodeableConcept (FHIR R4 uses coding.code, e.g. "active"). */
function statusCode(concept: CodeableConcept | undefined): string | null {
  return concept?.coding?.[0]?.code ?? concept?.text ?? null;
}

function effectiveTime(resource: FhirResource): string | null {
  return resource.effectiveDateTime ?? resource.occurrenceDateTime ??
    resource.effectivePeriod?.start ?? resource.occurrencePeriod?.start ?? null;
}

function updatedAt(resource: FhirResource, ...fallbacks: (string | null | undefined)[]): string {
  for (const value of [resource.meta?.lastUpdated, ...fallbacks]) {
    if (value) return value;
  }
  return fallbacks[fallbacks.length - 1] ?? "";
}

export function mapMedicationRequest(resource: FhirResource, nowIso: string, targets?: ReferenceTargets): NormalizedMedicationRequest {
  const concept = resource.medicationCodeableConcept;
  const rxnorm = findCoding(concept, "rxnorm");
  return {
    fhirPatientId: resourceReferenceId(resource.subject, "Patient", targets),
    fhirResourceId: String(resource.id ?? ""),
    rxnormCode: rxnorm?.code ?? null,
    // FHIR orders may carry the drug as medicationReference instead of a codeable concept; fall
    // back to the reference display so the chart shows the drug name rather than a placeholder.
    // (Full contained/bundled Medication resolution is a follow-up.)
    medicationDisplay: conceptDisplay(concept) ?? resource.medicationReference?.display ?? "Unspecified medication",
    dosageText: resource.dosageInstruction?.[0]?.text ?? null,
    status: resource.status ?? "unknown",
    intent: resource.intent ?? null,
    authoredOn: resource.authoredOn ?? null,
    requesterDisplay: resource.requester?.display ?? null,
    sourceUpdatedAt: resource.meta?.lastUpdated ?? resource.authoredOn ?? nowIso,
    raw: resource,
  };
}

export function mapMedicationAdministration(resource: FhirResource, targets?: ReferenceTargets): NormalizedMedicationAdministration {
  return {
    fhirPatientId: resourceReferenceId(resource.subject, "Patient", targets),
    fhirResourceId: String(resource.id ?? ""),
    fhirRequestId: resourceReferenceId(resource.request, "MedicationRequest", targets),
    status: resource.status ?? "unknown",
    medicationDisplay: conceptDisplay(resource.medicationCodeableConcept),
    effectiveAt: effectiveTime(resource),
    performerDisplay: resource.performer?.[0]?.actor?.display ?? null,
    raw: resource,
  };
}

export function mapAllergyIntolerance(resource: FhirResource, nowIso: string, targets?: ReferenceTargets): NormalizedAllergy {
  const coding = firstCoding(resource.code);
  // `category: "food"` (a bare string) and `reaction: {}` are common real-world mistakes; every
  // nested collection is checked for array shape rather than assumed.
  const categories = (Array.isArray(resource.category) ? resource.category : [])
    .filter((value): value is string => typeof value === "string");
  const manifestations = (Array.isArray(resource.reaction) ? resource.reaction : [])
    .flatMap((reaction) => (Array.isArray(reaction?.manifestation) ? reaction.manifestation : []))
    .map((concept) => conceptDisplay(concept))
    .filter((value): value is string => Boolean(value));
  return {
    // AllergyIntolerance references the subject via `patient`, not `subject`.
    fhirPatientId: resourceReferenceId(resource.patient ?? resource.subject, "Patient", targets),
    fhirResourceId: String(resource.id ?? ""),
    substanceDisplay: conceptDisplay(resource.code) ?? "Unspecified allergen",
    substanceCode: coding?.code ?? null,
    substanceSystem: classifyCodeSystem(coding?.system),
    clinicalStatus: statusCode(resource.clinicalStatus),
    verificationStatus: statusCode(resource.verificationStatus),
    criticality: resource.criticality ?? null,
    category: categories.length ? categories : null,
    reactionManifestations: manifestations.length ? manifestations : null,
    recordedDate: resource.recordedDate ?? null,
    sourceUpdatedAt: updatedAt(resource, resource.recordedDate, nowIso),
    raw: resource,
  };
}

export function mapCondition(resource: FhirResource, nowIso: string, targets?: ReferenceTargets): NormalizedCondition {
  const coding = firstCoding(resource.code);
  const firstCategory = resource.category?.[0] as CodeableConcept | undefined;
  return {
    fhirPatientId: resourceReferenceId(resource.subject, "Patient", targets),
    fhirResourceId: String(resource.id ?? ""),
    codeDisplay: conceptDisplay(resource.code) ?? "Unspecified condition",
    code: coding?.code ?? null,
    codeSystem: classifyCodeSystem(coding?.system),
    clinicalStatus: statusCode(resource.clinicalStatus),
    verificationStatus: statusCode(resource.verificationStatus),
    category: statusCode(firstCategory),
    onsetDate: resource.onsetDateTime ?? resource.onsetPeriod?.start ?? null,
    abatementDate: resource.abatementDateTime ?? null,
    recordedDate: resource.recordedDate ?? null,
    sourceUpdatedAt: updatedAt(resource, resource.recordedDate, resource.onsetDateTime, nowIso),
    raw: resource,
  };
}

export function mapServiceRequest(resource: FhirResource, nowIso: string, targets?: ReferenceTargets): NormalizedServiceRequest {
  const coding = firstCoding(resource.code);
  return {
    fhirPatientId: resourceReferenceId(resource.subject, "Patient", targets),
    fhirResourceId: String(resource.id ?? ""),
    codeDisplay: conceptDisplay(resource.code) ?? "Unspecified order",
    code: coding?.code ?? null,
    codeSystem: classifyCodeSystem(coding?.system),
    status: resource.status ?? "unknown",
    intent: resource.intent ?? null,
    priority: resource.priority ?? null,
    authoredOn: resource.authoredOn ?? null,
    requesterDisplay: resource.requester?.display ?? null,
    sourceUpdatedAt: updatedAt(resource, resource.authoredOn, nowIso),
    raw: resource,
  };
}

export function mapDocumentReference(resource: FhirResource, nowIso: string, targets?: ReferenceTargets): NormalizedDocumentReference {
  const attachment = resource.content?.[0]?.attachment;
  return {
    fhirPatientId: resourceReferenceId(resource.subject, "Patient", targets),
    fhirResourceId: String(resource.id ?? ""),
    typeDisplay: conceptDisplay(resource.type),
    typeCode: firstCoding(resource.type)?.code ?? null,
    status: resource.status ?? null,
    contentUrl: attachment?.url ?? null,
    contentType: attachment?.contentType ?? null,
    contextStart: resource.context?.period?.start ?? null,
    sourceUpdatedAt: updatedAt(resource, nowIso),
    raw: resource,
  };
}

/** Map a Bundle (or a single resource) into normalized clinical records. */
export function mapFhirBundle(bundle: FhirBundle | FhirResource, nowIso: string): NormalizedFhirBundle {
  const out: NormalizedFhirBundle = {
    medicationRequests: [],
    medicationAdministrations: [],
    allergies: [],
    conditions: [],
    serviceRequests: [],
    documentReferences: [],
    unsupported: [],
  };
  // A partner can send `entry` as an object where FHIR says array; that is bad input, not a crash.
  const rawEntries = (bundle as FhirBundle).entry;
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  // HL7 R4 Bundle 2.36.4.1 resolves identities against fullUrl before external lookup; multiple
  // matches may be treated as unresolved. Never infer a UUID target's type from its suffix.
  // https://hl7.org/fhir/R4/bundle.html#references
  const targets = new Map<string, FhirResource | null>();
  if (bundle.resourceType === "Bundle") {
    for (const entry of entries) {
      const fullUrl = entry?.fullUrl?.trim();
      if (!fullUrl) continue;
      targets.set(fullUrl, targets.has(fullUrl) ? null : entry.resource ?? null);
    }
  }
  const resources: FhirResource[] = bundle.resourceType === "Bundle"
    ? entries
      .map((entry) => entry?.resource)
      .filter((resource): resource is FhirResource => Boolean(resource))
    : bundle.resourceType
    ? [bundle as FhirResource]
    : [];
  for (const resource of resources) {
    switch (resource.resourceType) {
      case "MedicationRequest":
        out.medicationRequests.push(mapMedicationRequest(resource, nowIso, targets));
        break;
      case "MedicationAdministration":
        out.medicationAdministrations.push(mapMedicationAdministration(resource, targets));
        break;
      case "AllergyIntolerance":
        out.allergies.push(mapAllergyIntolerance(resource, nowIso, targets));
        break;
      case "Condition":
        out.conditions.push(mapCondition(resource, nowIso, targets));
        break;
      case "ServiceRequest":
        out.serviceRequests.push(mapServiceRequest(resource, nowIso, targets));
        break;
      case "DocumentReference":
        out.documentReferences.push(mapDocumentReference(resource, nowIso, targets));
        break;
      default:
        out.unsupported.push({ resourceType: resource.resourceType ?? "unknown", id: resource.id ?? null });
    }
  }
  return out;
}
