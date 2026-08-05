// Result shapes for retry-safe bulk operations.
//
// A `useBulkAction` wrapper used to live here, generating an idempotency key and handing it to a
// caller-supplied action. Nothing ever called it, so it was removed; the pure helpers below are the
// part with users (and tests). A bulk surface that needs a mutation should write its own and use
// `newIdempotencyKey`/`summarizeBulkResults`, which is what the shared value here really is.

export type BulkResultStatus = "success" | "skipped" | "unauthorized" | "failed";

export interface BulkRecordResult {
  id: string;
  status: BulkResultStatus;
  message?: string;
}

export interface BulkActionResult {
  idempotencyKey: string;
  total: number;
  succeeded: number;
  skipped: number;
  unauthorized: number;
  failed: number;
  results: BulkRecordResult[];
}

export function newIdempotencyKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

export function summarizeBulkResults(results: BulkRecordResult[], idempotencyKey: string): BulkActionResult {
  return {
    idempotencyKey,
    total: results.length,
    succeeded: results.filter((r) => r.status === "success").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    unauthorized: results.filter((r) => r.status === "unauthorized").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
