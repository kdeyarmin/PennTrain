import { describe, expect, it } from "vitest";
import { summarizeBulkResults, newIdempotencyKey } from "./bulkActions";

describe("bulk action result helpers", () => {
  it("summarizes per-record results for retry-safe partial operations", () => {
    const summary = summarizeBulkResults([
      { id: "a", status: "success" },
      { id: "b", status: "skipped" },
      { id: "c", status: "unauthorized" },
      { id: "d", status: "failed", message: "boom" },
    ], "bulk:test");
    expect(summary).toMatchObject({ idempotencyKey: "bulk:test", total: 4, succeeded: 1, skipped: 1, unauthorized: 1, failed: 1 });
  });

  it("generates scoped idempotency keys", () => {
    expect(newIdempotencyKey("alerts")).toMatch(/^alerts:/);
  });
});
