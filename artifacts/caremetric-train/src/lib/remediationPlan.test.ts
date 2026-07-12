import { describe, expect, it } from "vitest";
import { buildRemediationPlanDraft, remediationPlanToText } from "./remediationPlan";

describe("buildRemediationPlanDraft", () => {
  it("creates human-review remediation steps from prioritized readiness actions", () => {
    const plan = buildRemediationPlanDraft([
      { id: "1", kind: "citation_topic", title: "Fire drills", detail: "1/4 compliant", severity: "critical", priorityScore: 300 },
      { id: "2", kind: "entrance_item", title: "Current roster", detail: "Staff • missing", severity: "high", priorityScore: 240 },
    ]);

    expect(plan.summary).toContain("2 prioritized readiness gaps");
    expect(plan.steps).toEqual([
      expect.objectContaining({ title: "Fire drills", owner: "Compliance lead", dueInDays: 3 }),
      expect.objectContaining({ title: "Current roster", owner: "HR / staffing owner", dueInDays: 7 }),
    ]);
    expect(remediationPlanToText(plan)).toContain("Human review required");
  });
});
