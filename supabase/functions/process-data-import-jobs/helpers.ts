export const DURABLE_IMPORT_DOMAINS = [
  "employees",
  "rooms",
  "credentials",
  "residents",
  "training_records",
  "resident_contacts",
  "assessments",
  "incidents",
] as const;

const RESIDENT_CONTACT_TYPES = new Set([
  "emergency_contact",
  "designated_person",
  "guardian",
  "power_of_attorney",
  "primary_care_provider",
  "dentist",
  "pharmacy",
  "case_manager",
  "hospice_agency",
  "home_health_agency",
  "insurer",
  "other",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
}

function asInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function buildTrainingRecordPayload(normalizedRow: unknown) {
  const row = asRecord(normalizedRow);
  return {
    employee_id: asStringOrNull(row.employee_id),
    training_type_id: asStringOrNull(row.training_type_id),
    completion_date: asStringOrNull(row.completion_date),
    due_date: asStringOrNull(row.due_date),
    status: asStringOrNull(row.status) ?? "missing",
    completion_method: asStringOrNull(row.completion_method),
    training_provider: asStringOrNull(row.training_provider),
    notes: asStringOrNull(row.notes),
    document_required: asBoolean(row.document_required, false),
    approval_status: asStringOrNull(row.approval_status),
  };
}

export function buildResidentContactPayload(normalizedRow: unknown) {
  const row = asRecord(normalizedRow);
  const isPrimary = asBoolean(row.is_primary, false);
  const contactType = asStringOrNull(row.contact_type)?.toLowerCase();
  return {
    organization_id: asStringOrNull(row.organization_id),
    facility_id: asStringOrNull(row.facility_id),
    resident_id: asStringOrNull(row.resident_id),
    name: asStringOrNull(row.name) ?? "",
    relationship: asStringOrNull(row.relationship),
    email: asStringOrNull(row.email)?.toLowerCase() ?? null,
    phone: asStringOrNull(row.phone),
    is_primary: isPrimary,
    contact_type: contactType && RESIDENT_CONTACT_TYPES.has(contactType)
      ? contactType
      : (isPrimary ? "emergency_contact" : "other"),
    active: asBoolean(row.active, true),
  };
}

export function buildAssessmentPayload(normalizedRow: unknown) {
  const row = asRecord(normalizedRow);
  return {
    organization_id: asStringOrNull(row.organization_id),
    facility_id: asStringOrNull(row.facility_id),
    resident_id: asStringOrNull(row.resident_id),
    form_type: asStringOrNull(row.form_type),
    reason: asStringOrNull(row.reason),
    status: asStringOrNull(row.status) ?? "draft",
    prepared_date: asStringOrNull(row.prepared_date),
    content: asRecord(row.content),
    version_number: asInteger(row.version_number, 1),
    schema_version: asInteger(row.schema_version, 1),
  };
}

export function buildIncidentPayload(normalizedRow: unknown) {
  const row = asRecord(normalizedRow);
  return {
    organization_id: asStringOrNull(row.organization_id),
    facility_id: asStringOrNull(row.facility_id),
    occurred_at: asStringOrNull(row.occurred_at),
    incident_type: asStringOrNull(row.incident_type),
    severity: asStringOrNull(row.severity),
    narrative: asStringOrNull(row.narrative),
    resident_id: asStringOrNull(row.resident_id),
    resident_identifier_snapshot: asStringOrNull(row.resident_identifier_snapshot),
    location_detail: asStringOrNull(row.location_detail),
  };
}
