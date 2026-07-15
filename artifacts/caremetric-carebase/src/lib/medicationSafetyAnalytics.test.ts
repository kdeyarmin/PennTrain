import { describe, expect, it } from "vitest";
import { buildMedicationSafetySummary, classifyMedicationEvent } from "./medicationSafetyAnalytics";

describe("medication safety analytics", () => {
  it("classifies medication event types", () => {
    expect(classifyMedicationEvent("Wrong dose medication error")).toBe("wrong_dose");
    expect(classifyMedicationEvent("MAR documentation error")).toBe("documentation_error");
    expect(classifyMedicationEvent("Fall")).toBe("other");
  });

  it("summarizes unresolved and overdue follow-up", () => {
    const summary = buildMedicationSafetySummary({
      today: "2026-07-13",
      incidents: [
        { id: "i1", incident_type: "Wrong medication", status: "open", occurred_at: "2026-07-10", final_report_submitted_at: null },
        { id: "i2", incident_type: "Medication refusal", status: "closed", occurred_at: "2026-07-09", final_report_submitted_at: "2026-07-10" },
      ],
      correctiveActions: [{ id: "a1", incident_id: "i1", status: "in_progress", due_date: "2026-07-12" }],
    });
    expect(summary.totalEvents).toBe(2);
    expect(summary.unresolvedFollowUps).toBe(1);
    expect(summary.overdueFollowUps).toBe(1);
    expect(summary.retrainingRecommendations).toBeGreaterThan(0);
  });
});
