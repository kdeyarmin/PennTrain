import { useMutation } from "@tanstack/react-query";

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

export function useBulkAction<TInput extends { ids: string[] }, TResult extends BulkActionResult>(
  action: (input: TInput & { idempotencyKey: string; signal?: AbortSignal }) => Promise<TResult>,
) {
  return useMutation({
    mutationFn: async (input: TInput & { idempotencyKey?: string; signal?: AbortSignal }) =>
      action({ ...input, idempotencyKey: input.idempotencyKey ?? newIdempotencyKey("bulk") }),
  });
}
