import { describe, expect, it } from "vitest";
import { getTodayDestinations, summarizeDueWork } from "./todayWorkspace";

describe("summarizeDueWork", () => {
  it("keeps the KPI total separate from the eight-row preview", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      state: "open",
      due_at: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    }));

    const summary = summarizeDueWork(items, Date.parse("2026-07-05T12:00:00.000Z"));

    expect(summary.totalCount).toBe(10);
    expect(summary.visibleItems).toHaveLength(8);
    expect(summary.overdueCount).toBe(4);
    expect(summary.upcomingCount).toBe(6);
  });

  it("excludes terminal work from every count", () => {
    const summary = summarizeDueWork([
      { state: "closed", due_at: "2026-07-01T12:00:00.000Z" },
      { state: "canceled", due_at: "2026-07-02T12:00:00.000Z" },
      { state: "in_progress", due_at: "2026-07-03T12:00:00.000Z" },
    ], Date.parse("2026-07-04T12:00:00.000Z"));

    expect(summary.totalCount).toBe(1);
    expect(summary.overdueCount).toBe(1);
  });
});

describe("getTodayDestinations", () => {
  it("keeps auditor actions on auditor-accessible routes", () => {
    expect(getTodayDestinations("auditor")).toEqual({
      primary: { href: "/app/evidence", label: "Open Documentation Room" },
      handoffs: "/app/audit",
      coverage: "/app/reports",
      inspection: "/app/evidence",
      residentAndMedication: "/app/reports",
    });
  });

  it("preserves manager workflow destinations", () => {
    expect(getTodayDestinations("facility_manager").primary.href).toBe("/app/value-center");
    expect(getTodayDestinations("org_admin").coverage).toBe("/app/schedule");
  });
});
