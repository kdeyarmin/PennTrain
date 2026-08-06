export interface AlertCacheRow {
  id: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface AlertStatusResultRow {
  id: string;
  status: string;
  message?: string;
}

/**
 * `bulk_update_alert_status` returns a JSON envelope
 * `{ idempotencyKey, total, succeeded, skipped, unauthorized, failed, results: [...] }`.
 * Treat a bare array as a defensive fallback so a future signature change cannot re-break the UI.
 */
export function parseBulkAlertStatusResult(data: unknown): AlertStatusResultRow[] {
  if (Array.isArray(data)) {
    return data.filter(
      (row): row is AlertStatusResultRow =>
        !!row && typeof row === "object" && typeof (row as AlertStatusResultRow).id === "string"
          && typeof (row as AlertStatusResultRow).status === "string",
    );
  }
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return parseBulkAlertStatusResult((data as { results: unknown }).results);
  }
  return [];
}

/** Rows the RPC marks as rejected (not success/skipped). */
export function rejectedAlertStatusResults(rows: readonly AlertStatusResultRow[]): AlertStatusResultRow[] {
  return rows.filter((row) => row.status === "failed" || row.status === "unauthorized");
}

interface PaginatedAlertCache {
  rows: AlertCacheRow[];
  count: number;
  [key: string]: unknown;
}

function isPaginatedAlertCache(value: unknown): value is PaginatedAlertCache {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PaginatedAlertCache>;
  return Array.isArray(candidate.rows) && typeof candidate.count === "number";
}

function patchRows(
  rows: AlertCacheRow[],
  ids: ReadonlySet<string>,
  patch: Partial<AlertCacheRow>,
  statusFilter?: string,
) {
  const removeChangedRows = patch.status !== undefined
    && !!statusFilter
    && patch.status !== statusFilter;
  let removed = 0;
  const nextRows = rows.flatMap((row) => {
    if (!row.id || !ids.has(row.id)) return [row];
    if (removeChangedRows) {
      removed += 1;
      return [];
    }
    return [{ ...row, ...patch }];
  });
  return { rows: nextRows, removed };
}

/**
 * Apply an alert mutation to both legacy array queries and the paginated alert
 * queue. Rows that no longer match an active status filter leave the page
 * immediately; the mutation hook still refetches afterward for authoritative
 * ordering and counts.
 */
export function applyAlertCachePatch(
  value: unknown,
  ids: ReadonlySet<string>,
  patch: Partial<AlertCacheRow>,
  statusFilter?: string,
): unknown {
  if (Array.isArray(value)) {
    return patchRows(value as AlertCacheRow[], ids, patch, statusFilter).rows;
  }
  if (isPaginatedAlertCache(value)) {
    const next = patchRows(value.rows, ids, patch, statusFilter);
    return {
      ...value,
      rows: next.rows,
      count: Math.max(0, value.count - next.removed),
    };
  }
  return value;
}
