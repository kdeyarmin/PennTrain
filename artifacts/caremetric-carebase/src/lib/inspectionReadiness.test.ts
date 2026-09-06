import { describe, expect, it } from "vitest";
import {
  buildInspectionReadinessActions, inspectionReadinessVerdict, isOutstandingReadinessStatus,
  scopedInspectionItems, trainingReadinessVerdict,
} from "./inspectionReadiness";

describe("buildInspectionReadinessActions", () => {
  it("prioritizes citation gaps by weighted readiness and includes entrance checklist gaps", () => {
    const actions = buildInspectionReadinessActions({
      topics: [
        { id: "low-weight", title: "Low weight issue", citationRef: "2600.x", compliantCount: 1, totalCount: 2, frequencyWeight: 1 },
        { id: "high-weight", title: "High weight issue", citationRef: "2600.y", compliantCount: 1, totalCount: 4, frequencyWeight: 5 },
        { id: "ready", title: "Ready topic", citationRef: null, compliantCount: 2, totalCount: 2, frequencyWeight: 5 },
      ],
      checklistItems: [
        { id: "roster", category: "Staff", prompt: "Current roster", level: "attention", detail: "missing" },
        { id: "manual", category: "Policy", prompt: "Policy binder", level: "unknown" },
      ],
    });

    expect(actions.map((action) => action.id)).toEqual([
      "topic:high-weight",
      "entrance:roster",
      "entrance:manual",
      "topic:low-weight",
    ]);
    expect(actions[0]).toMatchObject({ severity: "critical", detail: "1/4 compliant • 2600.y" });
  });
});

// The two rules Survey Day and Inspection Readiness had drifted apart on. Both pages import these,
// so a regression on either surface fails here rather than on a survey morning.
describe("trainingReadinessVerdict", () => {
  it("ignores the superseded row a renewal leaves behind", () => {
    const verdict = trainingReadinessVerdict([
      // The pre-renewal record. The nightly recalc keeps grading it by its own completion date, so
      // it stays "expired" forever.
      { employee_id: "e1", training_type_id: "cpr", due_date: "2025-07-01", completion_date: "2024-07-01", status: "expired" },
      { employee_id: "e1", training_type_id: "cpr", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
    ]);

    expect(verdict).toEqual({ level: "ready" });
  });

  it("counts one outstanding current record per employee and training type", () => {
    const verdict = trainingReadinessVerdict([
      { employee_id: "e1", training_type_id: "cpr", due_date: "2026-09-01", completion_date: "2025-09-01", status: "compliant" },
      { employee_id: "e1", training_type_id: "fire", due_date: "2026-01-01", completion_date: "2025-01-01", status: "expired" },
      { employee_id: "e2", training_type_id: "cpr", due_date: "2026-02-01", completion_date: null, status: "due_soon" },
      { employee_id: "e3", training_type_id: "cpr", due_date: null, completion_date: null, status: "missing" },
    ]);

    expect(verdict).toEqual({ level: "attention", detail: "3 outstanding" });
  });

  it("is ready when there is no training on file at all", () => {
    // Unlike inspections, an empty training table is the roster being empty -- the roster prompt is
    // what reports that, and duplicating it here would double-count one gap.
    expect(trainingReadinessVerdict([])).toEqual({ level: "ready" });
  });
});

describe("inspectionReadinessVerdict", () => {
  const items = [
    { item_type: "fire_drill", status: "compliant" },
    { item_type: "fire_drill", status: "expired" },
    { item_type: "generator", status: "compliant" },
  ];

  it("grades an empty scoped set as attention, not ready", () => {
    // A facility with no fire-drill program has zero outstanding fire-drill items. Reading that as
    // Ready is the one state a surveyor is guaranteed to cite.
    expect(inspectionReadinessVerdict(items, ["emergency_plan"])).toEqual({
      level: "attention",
      detail: "nothing on file to check",
    });
    expect(inspectionReadinessVerdict([], null)).toEqual({
      level: "attention",
      detail: "nothing on file to check",
    });
  });

  it("only counts items the prompt's scope covers", () => {
    expect(inspectionReadinessVerdict(items, ["generator"])).toEqual({ level: "ready", detail: "1 on schedule" });
    expect(inspectionReadinessVerdict(items, ["fire_drill"])).toEqual({ level: "attention", detail: "1 outstanding" });
  });

  it("treats an absent or empty scope as covering every item", () => {
    expect(scopedInspectionItems(items, null)).toHaveLength(3);
    expect(scopedInspectionItems(items, [])).toHaveLength(3);
    expect(inspectionReadinessVerdict(items, [])).toEqual({ level: "attention", detail: "1 outstanding" });
  });

  it("counts exactly the three outstanding statuses", () => {
    expect(["expired", "due_soon", "missing"].every(isOutstandingReadinessStatus)).toBe(true);
    expect(["compliant", "not_applicable", "", null, undefined].some(isOutstandingReadinessStatus)).toBe(false);
  });
});
