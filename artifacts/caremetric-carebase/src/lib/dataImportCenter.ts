export const IMPORT_DOMAINS = [
  "employees", "training_records", "credentials", "residents", "resident_contacts",
  "rooms", "assessments", "incidents",
] as const;

export type ImportDomain = typeof IMPORT_DOMAINS[number];

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
