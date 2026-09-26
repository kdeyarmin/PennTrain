export type ExportRow = Record<string, unknown>;
export type ExportPageCursor = { offset: number; afterId: string | null };
export type CsvSink = { push(chunk: Uint8Array): Promise<void>; finish(): Promise<void> };

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^\s*[=+\-@]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}

/** Fetch the next page only after the previous page has drained into the archive. */
export async function streamOrganizationTableCsv(
  fetchPage: (cursor: ExportPageCursor) => Promise<ExportRow[]>,
  sink: CsvSink,
  pageSize = 1000,
): Promise<number> {
  const encoder = new TextEncoder();
  let columns: string[] | null = null;
  let rowCount = 0;
  let afterId: string | null = null;
  let useKeyset = true;
  for (;;) {
    const page = await fetchPage({ offset: useKeyset ? 0 : rowCount, afterId: useKeyset ? afterId : null });
    if (page.length > 0 && !columns) {
      columns = Object.keys(page[0]).sort();
      await sink.push(encoder.encode(columns.map(csvCell).join(",") + "\r\n"));
    }
    for (const row of page) {
      // SELECT * returns a stable schema. A concurrent schema change must fail the
      // export, not silently omit a column absent from an already-written header.
      const rowColumns = Object.keys(row);
      if (rowColumns.length !== columns!.length || rowColumns.some((key) => !columns!.includes(key))) {
        throw new Error("Export table schema changed; retry the export.");
      }
      await sink.push(encoder.encode(columns!.map((column) => csvCell(row[column])).join(",") + "\r\n"));
    }
    rowCount += page.length;
    if (page.length < pageSize) break;
    const lastId = page[page.length - 1]?.id;
    if (lastId === undefined || lastId === null) {
      useKeyset = false;
    } else if (useKeyset) {
      if (String(lastId) === afterId) throw new Error("Export page did not advance; retry the export.");
      afterId = String(lastId);
    }
  }
  await sink.finish();
  return rowCount;
}
