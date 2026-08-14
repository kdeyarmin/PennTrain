// Shared CSV building blocks. Every exporter in the app must escape cells through
// csvEscape so quoting and formula-injection hardening stay consistent. That formula
// hardening is spreadsheet-facing, though -- code that re-serializes CSV text for a
// machine consumer (no spreadsheet ever opens it) should use csvQuoteField instead;
// see its doc comment below.
import { downloadCsvText } from "./browserDownload";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * RFC 4180-ish CSV parser: quoted fields, embedded commas/newlines, and doubled-quote
 * ("") escaping. Real-world facility exports (Excel, other EMR/HR systems) routinely quote
 * fields that contain commas -- resident names ("Doe, Jane"), addresses, incident summaries
 * -- so a naive split(",") silently shifts columns instead of failing loudly. This mirrors
 * the header-keyed row shape the bulk-import-* edge functions already assume
 * (`parse(csv, { skipFirstRow: true })`) without adding a parsing dependency.
 *
 * Blank lines (including a stray trailing newline) are skipped entirely rather than
 * producing an all-empty row.
 */
export function parseCsv(text: string): ParsedCsv {
  const source = text.replace(/^﻿/, ""); // strip a UTF-8 BOM (common in Excel exports)
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\r") {
      // A lone \r is treated as a line end too; \r\n is handled by the \n branch below.
      if (source[i + 1] !== "\n") pushRow();
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const meaningfulRows = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (meaningfulRows.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...dataRows] = meaningfulRows;
  return { headers: headerRow.map((cell) => cell.trim()), rows: dataRows };
}

/**
 * Plain RFC 4180 field quoting: wraps a field in double quotes and doubles any embedded quotes
 * when it contains a comma, quote, or newline; otherwise returns it unchanged. No
 * formula-injection hardening -- this is the right tool for re-serializing CSV text that only
 * ever flows to another parser (e.g. an edge function), never opened directly in a spreadsheet.
 * csvEscape layers spreadsheet-safety hardening on top of exactly this for user-facing exports.
 */
export function csvQuoteField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Excel/Sheets execute cells starting with = + - @ (or tab/CR) as formulas, so
  // user-entered text (names, narratives, payees) could exfiltrate data when an
  // export is opened. Prefix a quote to force text -- but leave plain numbers
  // (e.g. "-5.25") alone so numeric columns still parse as numbers.
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text);
  return csvQuoteField(needsFormulaGuard ? `'${text}` : text);
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const headers = Array.from(rows.reduce((keys, row) => {
    Object.keys(row).forEach((key) => keys.add(key));
    return keys;
  }, new Set<string>()));
  // Header cells go through csvQuoteField for the same reason the data cells go through
  // csvEscape: a key carrying a comma or a quote would otherwise split the header row and
  // misalign every column beneath it. No formula guard -- a header is our own column name, not
  // user-entered text.
  const csv = [
    headers.map(csvQuoteField).join(","),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(",")),
  ].join("\n");
  downloadCsvText(filename, csv);
}
