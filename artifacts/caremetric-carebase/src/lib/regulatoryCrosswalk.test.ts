import { describe, expect, it } from "vitest";
import { buildRegulatoryCrosswalkRows, canManageRegulatoryCrosswalk, filterRegulatoryCrosswalkRows } from "./regulatoryCrosswalk";

describe("regulatory crosswalk", () => {
  const baseRows = () => buildRegulatoryCrosswalkRows({
    today: "2026-07-13",
    trainingRecords: [{ status: "current", due_date: "2026-08-01" }],
    credentials: [{ status: "expired", expiration_date: "2026-07-01" }],
    residentItems: [{ status: "missing", due_date: "2026-07-10", item_type: "RASP" }],
    incidents: [{ status: "open", final_report_submitted_at: null }],
    correctiveActions: [{ status: "in_progress", due_date: "2026-07-12" }],
    inspectionItems: [{ status: "current", due_date: "2026-09-01" }],
    violations: [{ status: "open", citation: "2600" }],
    policyDocuments: [{ current_version_id: null }],
    policyAttestations: [{ status: "pending", due_date: "2026-07-20" }],
    evidenceCollections: [],
  }, "auditor");

  it("filters by facility type", () => {
    const alrRows = filterRegulatoryCrosswalkRows(baseRows(), { facilityType: "ALR" });
    expect(alrRows.length).toBeGreaterThan(0);
    expect(alrRows.every((row) => row.facilityTypes.includes("ALR"))).toBe(true);
  });

  it("filters by citation text", () => {
    const rows = filterRegulatoryCrosswalkRows(baseRows(), { citation: "2800.64" });
    expect(rows).toEqual([expect.objectContaining({ id: "administrator-qualification" })]);
  });

  it("surfaces overdue and missing evidence statuses", () => {
    const rows = baseRows();
    expect(rows.some((row) => row.status === "overdue")).toBe(true);
    expect(rows.find((row) => row.id === "binder-evidence-room")?.status).toBe("missing_evidence");
  });

  it("filters by overdue status", () => {
    const rows = filterRegulatoryCrosswalkRows(baseRows(), { status: "overdue" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "overdue")).toBe(true);
  });

  it("keeps auditor access read-only", () => {
    expect(canManageRegulatoryCrosswalk("auditor")).toBe(false);
    expect(baseRows().every((row) => row.canEdit === false)).toBe(true);
  });
});
