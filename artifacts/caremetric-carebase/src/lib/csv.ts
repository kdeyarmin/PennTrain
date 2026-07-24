// Shared CSV building blocks. Every exporter in the app must escape cells through
// csvEscape so quoting and formula-injection hardening stay consistent.

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Excel/Sheets execute cells starting with = + - @ (or tab/CR) as formulas, so
  // user-entered text (names, narratives, payees) could exfiltrate data when an
  // export is opened. Prefix a quote to force text -- but leave plain numbers
  // (e.g. "-5.25") alone so numeric columns still parse as numbers.
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text);
  const safe = needsFormulaGuard ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const headers = Array.from(rows.reduce((keys, row) => {
    Object.keys(row).forEach((key) => keys.add(key));
    return keys;
  }, new Set<string>()));
  const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
