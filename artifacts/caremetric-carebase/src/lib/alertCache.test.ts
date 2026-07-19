import { describe, expect, it } from "vitest";
import { applyAlertCachePatch } from "./alertCache";

const alerts = [
  { id: "a1", status: "open", title: "First" },
  { id: "a2", status: "open", title: "Second" },
];

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
