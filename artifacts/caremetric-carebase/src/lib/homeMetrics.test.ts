import { describe, expect, it } from "vitest";
import {
  buildHomeMetrics,
  firstCall,
  highlightMetrics,
  HOME_METRIC_DEFINITIONS,
  homeMetricDefinition,
  type HomeAlertLike,
  type HomeMetricInput,
  type HomeWorkItemLike,
} from "./homeMetrics";

const NOW = new Date("2026-07-25T12:00:00Z");

function work(overrides: Partial<HomeWorkItemLike> = {}): HomeWorkItemLike {
  return {
    state: "open",
    priority: "normal",
    due_at: "2026-07-26T12:00:00Z",
    source_type: "assessment",
    ...overrides,
  };
}

function input(overrides: Partial<HomeMetricInput> = {}): HomeMetricInput {
  return {
    workItems: [],
    alerts: [],
    unfilledShifts: 0,
    openHandoffs: 0,
    facilityName: null,
    now: NOW,
    ...overrides,
  };
}

function valueOf(metrics: ReturnType<typeof buildHomeMetrics>, key: string) {
  return metrics.find((metric) => metric.key === key)!.value;
}

describe("the registry is the single definition", () => {
  // This is the phase's exit gate stated as a test: two metrics sharing a label would be two
  // definitions of the same thing, which is the failure the merge exists to end.
  it("gives no two metrics the same label", () => {
    const labels = HOME_METRIC_DEFINITIONS.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives no two metrics the same key", () => {
    const keys = HOME_METRIC_DEFINITIONS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("states a definition for every metric, long enough to be a real rule", () => {
    for (const entry of HOME_METRIC_DEFINITIONS) {
      expect(entry.definition.length, entry.key).toBeGreaterThan(30);
    }
  });

  it("gives every metric somewhere to go", () => {
    for (const entry of HOME_METRIC_DEFINITIONS) {
      expect(entry.href.startsWith("/app/"), entry.key).toBe(true);
    }
  });

  it("produces exactly the registry's metrics, in registry order", () => {
    expect(buildHomeMetrics(input()).map((metric) => metric.key))
      .toEqual(HOME_METRIC_DEFINITIONS.map((entry) => entry.key));
  });

  it("resolves a definition by key", () => {
    expect(homeMetricDefinition("critical_alerts")?.label).toBe("Critical alerts");
    expect(homeMetricDefinition("not_a_metric")).toBeUndefined();
  });
});

describe("work item counts", () => {
  it("counts an item whose due date has passed as overdue", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ due_at: "2026-07-24T12:00:00Z" })],
    }));
    expect(valueOf(metrics, "overdue_work")).toBe(1);
  });

  it("ignores closed and cancelled items everywhere", () => {
    // Matches get_work_item_queue's own predicate; an overdue item somebody closed is not work.
    const metrics = buildHomeMetrics(input({
      workItems: [
        work({ state: "closed", due_at: "2026-07-24T12:00:00Z", priority: "urgent" }),
        work({ state: "canceled", due_at: "2026-07-24T12:00:00Z", priority: "urgent" }),
      ],
    }));
    expect(valueOf(metrics, "overdue_work")).toBe(0);
    expect(valueOf(metrics, "urgent_work")).toBe(0);
    expect(valueOf(metrics, "due_this_week")).toBe(0);
  });

  it("counts an item due later today as due today", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ due_at: "2026-07-25T23:00:00Z" })],
    }));
    expect(valueOf(metrics, "due_today")).toBe(1);
  });

  it("includes an overdue item in due today, because it is still owed today", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ due_at: "2026-07-20T12:00:00Z" })],
    }));
    expect(valueOf(metrics, "due_today")).toBe(1);
    expect(valueOf(metrics, "overdue_work")).toBe(1);
  });

  it("includes overdue items in the seven-day count, as its definition says", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ due_at: "2026-07-20T12:00:00Z" }), work({ due_at: "2026-07-28T12:00:00Z" })],
    }));
    expect(valueOf(metrics, "due_this_week")).toBe(2);
  });

  it("excludes an item due beyond seven days", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ due_at: "2026-08-30T12:00:00Z" })],
    }));
    expect(valueOf(metrics, "due_this_week")).toBe(0);
    expect(valueOf(metrics, "due_today")).toBe(0);
  });

  it("counts urgent items regardless of due date", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ priority: "urgent", due_at: "2026-12-01T12:00:00Z" })],
    }));
    expect(valueOf(metrics, "urgent_work")).toBe(1);
    expect(valueOf(metrics, "due_this_week")).toBe(0);
  });

  it("ignores an unparseable due date rather than counting it as overdue", () => {
    const metrics = buildHomeMetrics(input({ workItems: [work({ due_at: "not a date" })] }));
    expect(valueOf(metrics, "overdue_work")).toBe(0);
    expect(valueOf(metrics, "due_today")).toBe(0);
  });
});

describe("alert counts", () => {
  const alert = (o: Partial<HomeAlertLike> = {}): HomeAlertLike => ({
    status: "open", severity: "warning", ...o,
  });

  it("counts open critical alerts separately from all open alerts", () => {
    const metrics = buildHomeMetrics(input({
      alerts: [alert({ severity: "critical" }), alert(), alert()],
    }));
    expect(valueOf(metrics, "critical_alerts")).toBe(1);
    expect(valueOf(metrics, "open_alerts")).toBe(3);
  });

  it("excludes resolved and dismissed alerts from both", () => {
    const metrics = buildHomeMetrics(input({
      alerts: [alert({ status: "resolved", severity: "critical" }), alert({ status: "dismissed" })],
    }));
    expect(valueOf(metrics, "critical_alerts")).toBe(0);
    expect(valueOf(metrics, "open_alerts")).toBe(0);
  });
});

describe("scope is always stated", () => {
  // The divergence that motivated this module: the same label meaning an org number on one surface
  // and a facility number on another, with neither saying which.
  it("labels the portfolio scope when no facility is selected", () => {
    for (const metric of buildHomeMetrics(input())) {
      expect(metric.scopeLabel).toBe("all permitted facilities");
    }
  });

  it("labels the facility by name when one is selected", () => {
    for (const metric of buildHomeMetrics(input({ facilityName: "Maple Court" }))) {
      expect(metric.scopeLabel).toBe("Maple Court");
    }
  });
});

describe("urgency and first call", () => {
  it("marks a metric urgent only when it is both positive and worth acting on", () => {
    const metrics = buildHomeMetrics(input({
      workItems: [work({ due_at: "2026-07-24T12:00:00Z" }), work({ due_at: "2026-07-28T12:00:00Z" })],
    }));
    expect(metrics.find((metric) => metric.key === "overdue_work")!.urgent).toBe(true);
    // Due-within-seven-days is positive but not something to drop everything for.
    expect(metrics.find((metric) => metric.key === "due_this_week")!.urgent).toBe(false);
  });

  it("points at the first urgent metric in registry order, not the largest number", () => {
    // Twenty overdue items and one uncovered shift: the shift must not be buried by the pile.
    const metrics = buildHomeMetrics(input({
      workItems: Array.from({ length: 20 }, () => work({ due_at: "2026-07-24T12:00:00Z" })),
      unfilledShifts: 1,
    }));
    expect(firstCall(metrics)?.key).toBe("overdue_work");

    const quiet = buildHomeMetrics(input({ unfilledShifts: 1 }));
    expect(firstCall(quiet)?.key).toBe("unfilled_shifts");
  });

  it("has no first call when nothing is outstanding", () => {
    expect(firstCall(buildHomeMetrics(input()))).toBeNull();
  });
});

describe("what gets shown", () => {
  it("keeps a zero for a metric worth reassuring about", () => {
    // "Overdue work: 0" is information. "Open handoffs: 0" is noise.
    const shown = highlightMetrics(buildHomeMetrics(input())).map((metric) => metric.key);
    expect(shown).toContain("overdue_work");
    expect(shown).not.toContain("open_handoffs");
  });

  it("shows a non-urgent metric once it has a value", () => {
    const shown = highlightMetrics(buildHomeMetrics(input({ openHandoffs: 3 })))
      .map((metric) => metric.key);
    expect(shown).toContain("open_handoffs");
  });
});

describe("operational counts pass through unchanged", () => {
  it("reports the coverage and handoff counts the operations RPC computed", () => {
    // These are computed server-side; recomputing them here would be a second definition.
    const metrics = buildHomeMetrics(input({ unfilledShifts: 2, openHandoffs: 5 }));
    expect(valueOf(metrics, "unfilled_shifts")).toBe(2);
    expect(valueOf(metrics, "open_handoffs")).toBe(5);
  });
});
