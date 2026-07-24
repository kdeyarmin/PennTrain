// Pure FHIR R4 -> normalized boundary-record mappers for the clinical ingestion boundary.
// The fhir-ingest edge function calls these to turn an inbound Bundle (or single resource)
// into the normalized payload that public.apply_fhir_integration_command drains into the
// fhir_medication_* tables. No database or network access -- fully unit-testable.

import { type CodeableConcept, conceptDisplay, findCoding } from "./fhirTerminology.ts";

interface Reference {
  reference?: string;
  display?: string;
}

interface FhirResource {
  resourceType?: string;
  id?: string;
  status?: string;
  intent?: string;
  subject?: Reference;
  request?: Reference;
  authoredOn?: string;
  requester?: Reference;
  medicationCodeableConcept?: CodeableConcept;
  dosageInstruction?: { text?: string }[];
  effectiveDateTime?: string;
  effectivePeriod?: { start?: string };
  occurrenceDateTime?: string;
  occurrencePeriod?: { start?: string };
  performer?: { actor?: Reference }[];
  meta?: { lastUpdated?: string };
}

interface FhirBundle {
  resourceType?: string;
  entry?: { resource?: FhirResource }[];
}

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

export interface NormalizedFhirBundle {
  medicationRequests: NormalizedMedicationRequest[];
  medicationAdministrations: NormalizedMedicationAdministration[];
  unsupported: { resourceType: string; id: string | null }[];
}

/** "Patient/abc", "urn:uuid:..", or a bare id -> bare id. */
export function referenceId(reference: string | undefined | null): string | null {
  if (!reference) return null;
  const trimmed = reference.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("urn:uuid:")) return trimmed.slice("urn:uuid:".length);
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function effectiveTime(resource: FhirResource): string | null {
  return resource.effectiveDateTime ?? resource.occurrenceDateTime ??
    resource.effectivePeriod?.start ?? resource.occurrencePeriod?.start ?? null;
}

export function mapMedicationRequest(resource: FhirResource, nowIso: string): NormalizedMedicationRequest {
  const concept = resource.medicationCodeableConcept;
  const rxnorm = findCoding(concept, "rxnorm");
  return {
    fhirPatientId: referenceId(resource.subject?.reference),
    fhirResourceId: String(resource.id ?? ""),
    rxnormCode: rxnorm?.code ?? null,
    medicationDisplay: conceptDisplay(concept) ?? "Unspecified medication",
    dosageText: resource.dosageInstruction?.[0]?.text ?? null,
    status: resource.status ?? "unknown",
    intent: resource.intent ?? null,
    authoredOn: resource.authoredOn ?? null,
    requesterDisplay: resource.requester?.display ?? null,
    sourceUpdatedAt: resource.meta?.lastUpdated ?? resource.authoredOn ?? nowIso,
    raw: resource,
  };
}

export function mapMedicationAdministration(resource: FhirResource): NormalizedMedicationAdministration {
  return {
    fhirPatientId: referenceId(resource.subject?.reference),
    fhirResourceId: String(resource.id ?? ""),
    fhirRequestId: referenceId(resource.request?.reference),
    status: resource.status ?? "unknown",
    medicationDisplay: conceptDisplay(resource.medicationCodeableConcept),
    effectiveAt: effectiveTime(resource),
    performerDisplay: resource.performer?.[0]?.actor?.display ?? null,
    raw: resource,
  };
}

/** Map a Bundle (or a single resource) into normalized medication records. */
export function mapFhirBundle(bundle: FhirBundle | FhirResource, nowIso: string): NormalizedFhirBundle {
  const out: NormalizedFhirBundle = {
    medicationRequests: [],
    medicationAdministrations: [],
    unsupported: [],
  };
  const resources: FhirResource[] = bundle.resourceType === "Bundle"
    ? ((bundle as FhirBundle).entry ?? [])
      .map((entry) => entry?.resource)
      .filter((resource): resource is FhirResource => Boolean(resource))
    : bundle.resourceType
    ? [bundle as FhirResource]
    : [];
  for (const resource of resources) {
    switch (resource.resourceType) {
      case "MedicationRequest":
        out.medicationRequests.push(mapMedicationRequest(resource, nowIso));
        break;
      case "MedicationAdministration":
        out.medicationAdministrations.push(mapMedicationAdministration(resource));
        break;
      default:
        out.unsupported.push({ resourceType: resource.resourceType ?? "unknown", id: resource.id ?? null });
    }
  }
  return out;
}
