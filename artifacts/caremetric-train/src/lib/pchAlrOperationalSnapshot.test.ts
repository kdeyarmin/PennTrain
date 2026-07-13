import { describe, expect, it } from "vitest";
import { buildPchAlrOperationsQueue, summarizePchAlrQueue } from "./pchAlrOperationalSnapshot";

describe("buildPchAlrOperationsQueue", () => {
  it("rolls live operational records into PCH/ALR daily queue buckets", () => {
    const queue = buildPchAlrOperationsQueue({
      today: "2026-07-13",
      trainingRecords: [{ status: "expired", due_date: "2026-07-01" }],
      credentials: [{ status: "missing", credential_type: "act34_criminal_history" }],
      residentItems: [{ status: "missing", due_date: "2026-07-10", item_type: "RASP" }],
      incidents: [{ status: "open", incident_type: "Medication error", final_report_submitted_at: null }],
      correctiveActions: [{ status: "in_progress", due_date: "2026-07-12" }],
      policyAttestations: [{ status: "pending", due_date: "2026-07-11" }],
    });

    expect(queue.find((item) => item.id === "daily-training")?.count).toBe(2);
    expect(queue.find((item) => item.id === "move-in-readiness")?.count).toBe(1);
    expect(queue.find((item) => item.id === "medication-safety")?.count).toBe(1);
    expect(queue.find((item) => item.id === "corrective-actions")?.count).toBe(1);
  });

  it("summarizes ready and attention buckets", () => {
    const summary = summarizePchAlrQueue(buildPchAlrOperationsQueue({ today: "2026-07-13" }));
    expect(summary.totalOpen).toBe(0);
    expect(summary.readyCount).toBeGreaterThan(0);
  });
});
