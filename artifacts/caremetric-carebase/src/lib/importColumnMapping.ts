import { csvEscape } from "@/lib/csv";
import { importColumns, requiredImportColumns, type ImportDomain } from "@/lib/dataImportCenter";

/**
 * D4 -- column-mapping UI for non-canonical CSVs.
 *
 * Maps each canonical column name for a domain to the index of the uploaded column that
 * supplies it, or null when the user has marked that canonical field "not present" (i.e. the
 * uploaded file simply doesn't have it -- only meaningful for optional fields; see
 * missingRequiredColumns).
 */
export type ColumnMapping = Record<string, number | null>;

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Common real-world header aliases (normalized -- lowercase, punctuation/spaces stripped) seen
 * in PA facility HR/EMR CSV exports, mapped to the canonical column they most likely correspond
 * to. This is only ever a fallback signal feeding suggestColumnMapping's auto-fill: the user
 * reviews every suggestion (and the row preview) before continuing, so a wrong guess here costs
 * a dropdown click, not a bad import.
 */
const HEADER_ALIASES: Record<string, string> = {
  dob: "date_of_birth",
  birthdate: "date_of_birth",
  emailaddress: "email",
  emp: "employee_number",
  empno: "employee_number",
  empid: "employee_number",
  emplid: "employee_number",
  employeeid: "employee_number",
  staffid: "employee_number",
  phonenumber: "phone",
  cellphone: "phone",
  mobilephone: "phone",
  mobile: "phone",
  telephone: "phone",
  roomno: "room_number",
  roomnum: "room_number",
  startdate: "hire_date",
  title: "job_title",
  position: "job_title",
  surname: "last_name",
  givenname: "first_name",
  unitname: "unit",
  license: "identifier",
  licenseno: "identifier",
  licensenumber: "identifier",
  certno: "identifier",
  certnumber: "identifier",
  credentialid: "identifier",
  credentialnumber: "identifier",
  expdate: "expiration_date",
  dateofincident: "occurred_at",
  incidentdate: "occurred_at",
  description: "summary",
  notes: "summary",
  residentid: "resident_external_id",
  chartnumber: "resident_external_id",
  mrn: "resident_external_id",
  primarycontact: "is_primary",
};

function bigrams(value: string): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < value.length - 1; i++) pairs.push(value.slice(i, i + 2));
  return pairs;
}

/** Sorensen-Dice coefficient over character bigrams -- a small, dependency-free fuzzy match. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  const remaining = new Map<string, number>();
  for (const pair of bigramsA) remaining.set(pair, (remaining.get(pair) ?? 0) + 1);
  let matches = 0;
  for (const pair of bigramsB) {
    const count = remaining.get(pair) ?? 0;
    if (count > 0) {
      matches += 1;
      remaining.set(pair, count - 1);
    }
  }
  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

/** 0..1 confidence that an uploaded header supplies a given canonical column. */
export function headerSimilarity(uploadedHeader: string, canonicalColumn: string): number {
  const header = normalizeHeader(uploadedHeader);
  const canonical = normalizeHeader(canonicalColumn);
  if (!header || !canonical) return 0;
  if (header === canonical) return 1;
  const alias = HEADER_ALIASES[header];
  if (alias && normalizeHeader(alias) === canonical) return 0.95;
  if (header.includes(canonical) || canonical.includes(header)) {
    return 0.6 + 0.3 * (Math.min(header.length, canonical.length) / Math.max(header.length, canonical.length));
  }
  return diceCoefficient(header, canonical) * 0.75;
}

/** Minimum confidence before a suggestion is auto-filled rather than left for the user to pick. */
const AUTO_MATCH_THRESHOLD = 0.55;

/**
 * Exact, case-sensitive set match between the uploaded header row and a domain's canonical
 * columns -- this is what the active bulk-import-* processors require today (they parse CSV
 * with `parse(csv, { skipFirstRow: true })` and look up rows by literal key, e.g.
 * `"first_name" in rows[0]`). When this is true, the mapping step is skipped entirely and the
 * uploaded CSV flows through unchanged, exactly as it did before D4.
 */
export function headersMatchCanonical(uploadedHeaders: string[], domain: ImportDomain): boolean {
  const canonical = importColumns(domain);
  if (uploadedHeaders.length !== canonical.length) return false;
  const uploadedSet = new Set(uploadedHeaders);
  if (uploadedSet.size !== uploadedHeaders.length) return false; // duplicate header guard
  return canonical.every((column) => uploadedSet.has(column));
}

/**
 * Best-effort starting mapping: greedily pairs each canonical column with the uploaded header
 * that best matches it (case-insensitive/normalized exact match first, then alias and fuzzy
 * matches), never reusing an uploaded column for two canonical fields. Anything left unmatched
 * is null ("not present") for the user to fill in or confirm is genuinely absent.
 */
export function suggestColumnMapping(uploadedHeaders: string[], domain: ImportDomain): ColumnMapping {
  const canonical = importColumns(domain);
  const candidates: Array<{ column: string; headerIndex: number; score: number }> = [];
  for (const column of canonical) {
    uploadedHeaders.forEach((header, headerIndex) => {
      const score = headerSimilarity(header, column);
      if (score >= AUTO_MATCH_THRESHOLD) candidates.push({ column, headerIndex, score });
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping = Object.fromEntries(canonical.map((column) => [column, null]));
  const usedHeaderIndexes = new Set<number>();
  for (const candidate of candidates) {
    if (mapping[candidate.column] !== null) continue;
    if (usedHeaderIndexes.has(candidate.headerIndex)) continue;
    mapping[candidate.column] = candidate.headerIndex;
    usedHeaderIndexes.add(candidate.headerIndex);
  }
  return mapping;
}

/** Required canonical columns (per dataImportCenter.requiredImportColumns) the mapping hasn't assigned a source column to. */
export function missingRequiredColumns(domain: ImportDomain, mapping: ColumnMapping): string[] {
  return requiredImportColumns(domain).filter((column) => mapping[column] === null || mapping[column] === undefined);
}

/** The value a mapped canonical column resolves to for one uploaded data row ("" when unmapped). */
export function mappedCellValue(row: string[], mapping: ColumnMapping, column: string): string {
  const index = mapping[column];
  if (index === null || index === undefined) return "";
  return row[index] ?? "";
}

/**
 * Renders the uploaded rows through the mapping into a canonical CSV: the full canonical header
 * row, in canonical order, with each cell pulled from its mapped uploaded column (blank for a
 * field marked "not present"). This re-mapped text is what actually crosses into the existing
 * D3 dry-run/apply pipeline via runImportChunks -- the bulk-import-* edge functions parse CSV by
 * header name, so a CSV with exactly the canonical headers behaves identically whether or not
 * the source file needed mapping. No edge function, RPC, or ledger schema change is involved.
 */
export function applyColumnMapping(domain: ImportDomain, uploadedRows: string[][], mapping: ColumnMapping): string {
  const canonical = importColumns(domain);
  const headerLine = canonical.map((column) => csvEscape(column)).join(",");
  const dataLines = uploadedRows.map((row) =>
    canonical.map((column) => csvEscape(mappedCellValue(row, mapping, column))).join(","),
  );
  return [headerLine, ...dataLines].join("\n") + "\n";
}
