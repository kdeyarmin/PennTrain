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

  it("surfaces overdue and missing documentation statuses", () => {
    const rows = baseRows();
    expect(rows.some((row) => row.status === "overdue")).toBe(true);
    expect(rows.find((row) => row.id === "binder-evidence-room")?.status).toBe("missing_evidence");
  });

  it("filters by overdue status", () => {
    const rows = filterRegulatoryCrosswalkRows(baseRows(), { status: "overdue" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "overdue")).toBe(true);
  });

  it("ignores completed and cancelled corrective actions past their due date", () => {
    const rows = buildRegulatoryCrosswalkRows({
      today: "2026-07-13",
      incidents: [{ status: "closed", final_report_submitted_at: "2026-07-01" }],
      correctiveActions: [
        { status: "cancelled", due_date: "2026-07-01" },
        { status: "completed", due_date: "2026-06-15" },
      ],
      inspectionItems: [{ status: "compliant", due_date: "2026-09-01" }],
      violations: [],
    }, "org_admin");

    expect(rows.find((row) => row.id === "incident-reporting")?.gapCount).toBe(0);
    expect(rows.find((row) => row.id === "physical-site-emergency")?.gapCount).toBe(0);
  });

  it("keeps auditor access read-only", () => {
    expect(canManageRegulatoryCrosswalk("auditor")).toBe(false);
    expect(baseRows().every((row) => row.canEdit === false)).toBe(true);
  });
});

describe("satisfied evidence stops counting as a gap once its due date passes", () => {
  // A row completed even one day late keeps `due_date < today` for good. Counting that as an open
  // gap made the crosswalk row permanently uncovered with no action available to clear it -- which
  // is why this asserts zero gaps rather than a smaller number.
  it("does not count a compliant resident item completed after its due date", () => {
    const rows = buildRegulatoryCrosswalkRows({
      today: "2026-08-05",
      residentItems: [
        { status: "compliant", due_date: "2026-07-10", item_type: "RASP" },
        { status: "not_applicable", due_date: "2026-06-01", item_type: "RASP" },
      ],
    });
    const resident = rows.filter((row) => row.gapCount > 0 && row.evidenceCount > 0);
    expect(resident.every((row) => row.gapCount === 0)).toBe(true);
  });

  it("does not count an attested policy attestation past its due date", () => {
    const rows = buildRegulatoryCrosswalkRows({
      today: "2026-08-05",
      policyDocuments: [{ current_version_id: "v1" }],
      policyAttestations: [{ status: "attested", due_date: "2026-07-20" }],
    });
    expect(rows.some((row) => row.gapCount > 0)).toBe(false);
  });
});
