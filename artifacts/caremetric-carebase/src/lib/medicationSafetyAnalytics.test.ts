import { describe, expect, it } from "vitest";
import { buildMedicationSafetySummary, classifyMedicationEvent } from "./medicationSafetyAnalytics";

describe("medication safety analytics", () => {
  it("classifies medication event types", () => {
    expect(classifyMedicationEvent("Wrong dose medication error")).toBe("wrong_dose");
    expect(classifyMedicationEvent("MAR documentation error")).toBe("documentation_error");
    expect(classifyMedicationEvent("Fall")).toBeNull();
    // The canonical incidents.incident_type value must classify as a
    // medication event (generic subtype), not fall out of the summary.
    expect(classifyMedicationEvent("medication_error")).toBe("other");
  });

  it("counts canonical medication_error incidents in the summary", () => {
    const summary = buildMedicationSafetySummary({
      today: "2026-07-13",
      incidents: [
        { id: "i1", incident_type: "medication_error", status: "open", occurred_at: "2026-07-10", final_report_submitted_at: null },
        { id: "i2", incident_type: "fall", status: "open", occurred_at: "2026-07-10", final_report_submitted_at: null },
      ],
      correctiveActions: [],
    });
    expect(summary.totalEvents).toBe(1);
    expect(summary.byType.other).toBe(1);
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
