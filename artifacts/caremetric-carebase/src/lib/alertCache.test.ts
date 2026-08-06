import { describe, expect, it } from "vitest";
import { applyAlertCachePatch, parseBulkAlertStatusResult, rejectedAlertStatusResults } from "./alertCache";

const alerts = [
  { id: "a1", status: "open", title: "First" },
  { id: "a2", status: "open", title: "Second" },
];

describe("parseBulkAlertStatusResult", () => {
  it("reads the envelope the RPC actually returns", () => {
    expect(parseBulkAlertStatusResult({
      idempotencyKey: "k",
      total: 2,
      succeeded: 1,
      skipped: 0,
      unauthorized: 0,
      failed: 1,
      results: [
        { id: "a1", status: "success" },
        { id: "a2", status: "failed", message: "Alert not found" },
      ],
    })).toEqual([
      { id: "a1", status: "success" },
      { id: "a2", status: "failed", message: "Alert not found" },
    ]);
  });

  it("accepts a bare array as a defensive fallback", () => {
    expect(parseBulkAlertStatusResult([{ id: "a1", status: "success" }])).toEqual([
      { id: "a1", status: "success" },
    ]);
  });

  it("does not treat the envelope object itself as the result list", () => {
    // Regression: casting the envelope to an array and calling .filter threw, so every
    // bulk resolve/dismiss looked like a client failure even when the RPC succeeded.
    expect(parseBulkAlertStatusResult({ results: [{ id: "a1", status: "success" }] })).toHaveLength(1);
    expect(rejectedAlertStatusResults(parseBulkAlertStatusResult({
      results: [
        { id: "a1", status: "success" },
        { id: "a2", status: "unauthorized", message: "Not authorized" },
        { id: "a3", status: "skipped", message: "Already resolved" },
      ],
    }))).toEqual([{ id: "a2", status: "unauthorized", message: "Not authorized" }]);
  });
});

describe("applyAlertCachePatch", () => {
  it("updates matching rows in legacy array caches", () => {
    expect(applyAlertCachePatch(alerts, new Set(["a1"]), { status: "resolved" })).toEqual([
      { id: "a1", status: "resolved", title: "First" },
      alerts[1],
    ]);
  });

  it("removes rows that no longer match a paginated status filter", () => {
    expect(applyAlertCachePatch(
      { rows: alerts, count: 8 },
      new Set(["a1"]),
      { status: "resolved" },
      "open",
    )).toEqual({ rows: [alerts[1]], count: 7 });
  });

  it("handles bulk updates without allowing counts below zero", () => {
    expect(applyAlertCachePatch(
      { rows: alerts, count: 1 },
      new Set(["a1", "a2"]),
      { status: "dismissed" },
      "open",
    )).toEqual({ rows: [], count: 0 });
  });

  it("leaves unrelated cache values untouched", () => {
    const value = { total: 3 };
    expect(applyAlertCachePatch(value, new Set(["a1"]), { status: "resolved" })).toBe(value);
  });
});
