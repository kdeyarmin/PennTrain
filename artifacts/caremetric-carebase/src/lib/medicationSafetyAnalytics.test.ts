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

  // 'cancelled' is a terminal corrective_actions.status alongside 'completed'
  // (20260705021954_incidents_core.sql), and the operations-snapshot SQL that computes the same
  // number excludes both. Counting a called-off action as overdue also drives a retraining
  // recommendation off it, so the error does not stop at one inflated tile.
  it("does not count a cancelled corrective action as an overdue follow-up", () => {
    const summary = buildMedicationSafetySummary({
      today: "2026-07-13",
      incidents: [
        { id: "i1", incident_type: "Medication refusal", status: "reported", occurred_at: "2026-07-10", final_report_submitted_at: null },
      ],
      correctiveActions: [{ id: "a1", incident_id: "i1", status: "cancelled", due_date: "2026-07-01" }],
    });
    expect(summary.overdueFollowUps).toBe(0);
    expect(summary.retrainingRecommendations).toBe(0);
    expect(summary.events[0].followUpOverdue).toBe(false);
  });

  // 'reported' and 'investigating' are the other two legal incidents.status values; only 'closed'
  // is terminal, and it still needs the final report before the event counts as closed.
  it("treats an investigating incident as open even with its final report filed", () => {
    const summary = buildMedicationSafetySummary({
      today: "2026-07-13",
      incidents: [
        { id: "i1", incident_type: "Wrong dose", status: "investigating", occurred_at: "2026-07-10", final_report_submitted_at: "2026-07-11" },
      ],
      correctiveActions: [],
    });
    expect(summary.events[0].status).toBe("open");
    expect(summary.unresolvedFollowUps).toBe(1);
  });
});
