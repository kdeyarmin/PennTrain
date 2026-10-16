import { csvEscape, parseCsv } from "@/lib/csv";

/** Columns the staff spreadsheet accepts. The first four are what a new customer must fill in. */
export const EMPLOYEE_IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "job_title",
  "facility_name",
  "email",
  "phone",
  "employee_number",
  "department",
  "hire_date",
  "status",
  "administers_medications",
  "trainer_status",
] as const;

const REQUIRED_COLUMNS = ["first_name", "last_name", "job_title"] as const;
const STATUSES = new Set(["active", "inactive", "terminated", "on_leave"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMPLOYEE_IMPORT_ROW_LIMIT = 1000;

export interface EmployeeCsvPreviewRow {
  /** Spreadsheet row number. Row 1 is the header. */
  row: number;
  firstName: string;
  lastName: string;
  jobTitle: string;
  facilityName: string;
  email: string;
  errors: string[];
}

export interface EmployeeCsvPreview {
  headerErrors: string[];
  rows: EmployeeCsvPreviewRow[];
  validCount: number;
  invalidCount: number;
}

export function employeeImportTemplate(facilityName: string): string {
  const example = [
    "Avery",
    "Chen",
    "Caregiver",
    facilityName,
    "avery.chen@example.com",
    "717-555-0100",
    "E-100",
    "Direct care",
    "2026-01-15",
    "active",
    "false",
    "false",
  ];
  return `${EMPLOYEE_IMPORT_HEADERS.join(",")}\n${example.map((cell) => csvEscape(cell)).join(",")}\n`;
}

function cell(row: string[], index: Record<string, number>, key: string): string {
  const position = index[key];
  if (position === undefined) return "";
  return (row[position] ?? "").trim();
}

/**
 * Read a staff spreadsheet the way the import will, before anything is saved.
 * Facility names are matched against the caller's locations, case-insensitively.
 */
export function previewEmployeeCsv(csv: string, facilityNames: readonly string[]): EmployeeCsvPreview {
  const parsed = parseCsv(csv);
  const headerErrors: string[] = [];
  if (parsed.headers.length === 0) {
    headerErrors.push("This file needs a header row. Download the template and keep its first row.");
  }
  const headers = new Set(parsed.headers);
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.has(column));
  if (parsed.headers.length > 0 && missing.length > 0) {
    headerErrors.push(`Missing required columns: ${missing.join(", ")}.`);
  }
  if (parsed.headers.length > 0 && !headers.has("facility_name") && !headers.has("facility_id")) {
    headerErrors.push("Missing required column: facility_name.");
  }
  if (parsed.headers.length > 0 && parsed.rows.length === 0) {
    headerErrors.push("The file has a header but no staff rows.");
  }
  if (parsed.rows.length > EMPLOYEE_IMPORT_ROW_LIMIT) {
    headerErrors.push(`This file has more than ${EMPLOYEE_IMPORT_ROW_LIMIT} rows. Split it into smaller files.`);
  }

  if (headerErrors.length > 0) {
    return { headerErrors, rows: [], validCount: 0, invalidCount: 0 };
  }

  const known = new Set(facilityNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const index = Object.fromEntries(parsed.headers.map((header, position) => [header, position]));
  const rows = parsed.rows.map((raw, position) => {
    const errors: string[] = [];
    const firstName = cell(raw, index, "first_name");
    const lastName = cell(raw, index, "last_name");
    const jobTitle = cell(raw, index, "job_title");
    const facilityName = cell(raw, index, "facility_name");
    const facilityId = cell(raw, index, "facility_id");
    const email = cell(raw, index, "email");
    const hireDate = cell(raw, index, "hire_date");
    const status = (cell(raw, index, "status") || "active").toLowerCase().replace(/\s+/g, "_");

    if (!firstName) errors.push("First name is required.");
    if (!lastName) errors.push("Last name is required.");
    if (!jobTitle) errors.push("Job title is required.");
    if (!facilityName && !facilityId) errors.push("Facility name is required.");
    else if (facilityName && known.size > 0 && !known.has(facilityName.toLowerCase())) {
      errors.push(`No location named “${facilityName}”. Use the facility name exactly.`);
    }
    if (hireDate && !DATE_PATTERN.test(hireDate)) errors.push("Hire date must be YYYY-MM-DD.");
    if (!STATUSES.has(status)) errors.push("Status must be active, inactive, terminated, or on leave.");
    if (email && !EMAIL_PATTERN.test(email)) errors.push("Email does not look valid.");

    return {
      row: position + 2,
      firstName,
      lastName,
      jobTitle,
      facilityName: facilityName || facilityId,
      email,
      errors,
    };
  });

  return {
    headerErrors,
    rows,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    invalidCount: rows.filter((row) => row.errors.length > 0).length,
  };
}
