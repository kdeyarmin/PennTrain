export const IMPORT_DOMAINS = [
  "employees", "training_records", "credentials", "residents", "resident_contacts",
  "rooms", "assessments", "incidents",
] as const;

export type ImportDomain = typeof IMPORT_DOMAINS[number];

export type ImportDomainAvailability = "active" | "template_only";

export interface ImportDomainDefinition {
  domain: ImportDomain;
  availability: ImportDomainAvailability;
  availabilityLabel: "Active" | "Template only";
  description: string;
}

/**
 * This is the product contract, not a statement that a CSV template has a
 * processor. A domain must not become active until its preview, apply,
 * matching, receipt, authorization, and journey coverage are complete.
 */
export const IMPORT_DOMAIN_DEFINITIONS: readonly ImportDomainDefinition[] = IMPORT_DOMAINS.map((domain) => {
  const availability: ImportDomainAvailability = domain === "employees" ? "active" : "template_only";
  return {
    domain,
    availability,
    availabilityLabel: availability === "active" ? "Active" : "Template only",
    description: availability === "active"
      ? "Dry-run and apply processor available"
      : "Canonical template for migration planning; upload is not yet available",
  };
});

export function canUploadImportDomain(domain: ImportDomain): boolean {
  return IMPORT_DOMAIN_DEFINITIONS.find((definition) => definition.domain === domain)?.availability === "active";
}

const columns: Record<ImportDomain, readonly string[]> = {
  employees: ["employee_number", "first_name", "last_name", "email", "facility_name", "job_title", "hire_date", "department", "phone", "status", "trainer_status", "administers_medications"],
  training_records: ["employee_number", "course_code", "completion_date", "expiration_date", "source"],
  credentials: ["employee_number", "credential_type", "identifier", "issue_date", "expiration_date"],
  residents: ["external_id", "first_name", "last_name", "date_of_birth", "facility", "room"],
  resident_contacts: ["resident_external_id", "name", "relationship", "email", "phone", "is_primary"],
  rooms: ["facility", "room_number", "unit", "capacity", "status"],
  assessments: ["resident_external_id", "assessment_type", "assessment_date", "status", "source_reference"],
  incidents: ["resident_external_id", "facility", "occurred_at", "incident_type", "severity", "summary"],
};

export function importTemplate(domain: ImportDomain): string {
  return `${columns[domain].join(",")}\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function rowsToErrorCsv(rows: Array<{ row_number: number; source_row: unknown; errors: unknown; warnings: unknown }>): string {
  const quote = (value: unknown) => `"${JSON.stringify(value ?? "").replaceAll('"', '""')}"`;
  const diagnosticRows = rows.filter((row) =>
    (Array.isArray(row.errors) && row.errors.length > 0) || (Array.isArray(row.warnings) && row.warnings.length > 0),
  );
  return ["row_number,errors,warnings,source_row", ...diagnosticRows.map((row) =>
    [row.row_number, quote(row.errors), quote(row.warnings), quote(row.source_row)].join(","),
  )].join("\n");
}
