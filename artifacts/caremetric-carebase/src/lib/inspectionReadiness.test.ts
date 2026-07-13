import { describe, expect, it } from "vitest";
import { buildInspectionReadinessActions } from "./inspectionReadiness";

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
