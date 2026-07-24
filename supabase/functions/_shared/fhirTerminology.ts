// FHIR R4 terminology helpers. Offline classification of the coding systems the clinical
// ingestion boundary understands -- no network calls. Extraction stays lenient: an unknown
// code system is not fatal (the coded value is simply not pinned to a known vocabulary), so
// callers can still ingest the human-readable display and flag gaps downstream.

export type CodeSystem = "rxnorm" | "snomed" | "icd10cm" | "loinc" | "ucum" | "unii";

const SYSTEM_URIS: Record<string, CodeSystem> = {
  "http://www.nlm.nih.gov/research/umls/rxnorm": "rxnorm",
  "http://snomed.info/sct": "snomed",
  "http://hl7.org/fhir/sid/icd-10-cm": "icd10cm",
  "http://loinc.org": "loinc",
  "http://unitsofmeasure.org": "ucum",
  "http://fdasis.nlm.nih.gov": "unii",
};

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

/** Map a FHIR system URI to a known code system, or null when unrecognized. */
export function classifyCodeSystem(systemUri: string | undefined | null): CodeSystem | null {
  if (!systemUri) return null;
  return SYSTEM_URIS[systemUri.trim()] ?? null;
}

/** First coding whose system classifies to `target`. */
export function findCoding(concept: CodeableConcept | undefined, target: CodeSystem): Coding | null {
  if (!concept?.coding) return null;
  return concept.coding.find((coding) => classifyCodeSystem(coding.system) === target) ?? null;
}

/** Human-readable label: first coding display, else concept text, else first code. */
export function conceptDisplay(concept: CodeableConcept | undefined): string | null {
  if (!concept) return null;
  const withDisplay = concept.coding?.find((coding) => Boolean(coding.display));
  return withDisplay?.display ?? concept.text ?? concept.coding?.[0]?.code ?? null;
}
