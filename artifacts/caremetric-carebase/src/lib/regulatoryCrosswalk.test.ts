import { describe, expect, it } from "vitest";
import type { ActiveRegulatoryRule } from "@/hooks/useRegulatoryRules";
import {
  activeRulePacksForJurisdiction,
  buildRegulatoryCrosswalkRows,
  canManageRegulatoryCrosswalk,
  filterRegulatoryCrosswalkRows,
  governedRuleForObligation,
} from "./regulatoryCrosswalk";

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

describe("overdue is read off the gap records, not off every record", () => {
  // `sortedDates` carries the dates of SATISFIED evidence as well. One attested attestation whose
  // due date has passed, beside one still pending and due next week, made the row read "Overdue" --
  // on the surveyor-facing card and in the CSV handed to a surveyor -- with nothing overdue.
  it("reads needs_attention, not overdue, when only settled evidence is in the past", () => {
    const rows = buildRegulatoryCrosswalkRows({
      today: "2026-08-05",
      policyDocuments: [{ current_version_id: "v1" }],
      policyAttestations: [
        { status: "attested", due_date: "2026-07-01" },
        { status: "pending", due_date: "2026-08-12" },
      ],
    });
    const policyRows = rows.filter((row) => row.evidenceSource === "policy");
    expect(policyRows.length).toBeGreaterThan(0);
    expect(policyRows.every((row) => row.gapCount === 1)).toBe(true);
    expect(policyRows.every((row) => row.status === "needs_attention")).toBe(true);
    expect(policyRows.some((row) => row.status === "overdue")).toBe(false);
  });

  it("still reads overdue when the outstanding record itself is in the past", () => {
    const rows = buildRegulatoryCrosswalkRows({
      today: "2026-08-05",
      policyDocuments: [{ current_version_id: "v1" }],
      policyAttestations: [
        { status: "attested", due_date: "2026-07-01" },
        { status: "pending", due_date: "2026-07-30" },
      ],
    });
    const policyRows = rows.filter((row) => row.evidenceSource === "policy");
    expect(policyRows.every((row) => row.status === "overdue")).toBe(true);
  });

  it("applies the same rule to a compliant resident item completed late", () => {
    const rows = buildRegulatoryCrosswalkRows({
      today: "2026-08-05",
      residentItems: [
        { status: "compliant", due_date: "2026-07-10", item_type: "RASP" },
        { status: "missing", due_date: "2026-08-20", item_type: "RASP" },
      ],
    });
    const residentRows = rows.filter((row) => row.evidenceSource === "resident");
    expect(residentRows.every((row) => row.status === "needs_attention")).toBe(true);
  });
});

describe("governed rule lookup", () => {
  const rule = (overrides: Partial<ActiveRegulatoryRule>): ActiveRegulatoryRule => ({
    id: "rule-1",
    version_number: 3,
    state: "active",
    citation: "55 Pa. Code 2600.65",
    source_uri: null,
    source_checksum_sha256: "abc",
    content_checksum_sha256: "def",
    effective_from: "2026-01-01",
    effective_to: null,
    applicability: {},
    calculation_parameters: {},
    regulatory_rule_packs: { rule_key: "pa.pch", name: "PA PCH personnel" },
    ...overrides,
  });

  const pchRule = rule({
    id: "pch",
    citation: "55 Pa. Code 2600.65",
    applicability: { stateCodes: ["PA"], facilityTypes: ["PCH"], crosswalkObligationId: "staff-training" },
  });
  const alrRule = rule({
    id: "alr",
    citation: "55 Pa. Code 2800.65",
    applicability: { stateCodes: ["PA"], facilityTypes: ["ALR"], crosswalkObligationId: "staff-training" },
    regulatory_rule_packs: { rule_key: "pa.alr", name: "PA ALF personnel" },
  });

  // Both PA packs are active at once and both map to the same obligations. Keyed on the obligation
  // alone, `.find` returns whichever came back first -- so a personal care home's row carried the
  // assisted living citation, with a "Governed" badge, into the surveyor-facing CSV.
  it("returns the pack that matches the facility's own program", () => {
    expect(governedRuleForObligation([pchRule, alrRule], "staff-training", "PCH")?.id).toBe("pch");
    expect(governedRuleForObligation([pchRule, alrRule], "staff-training", "ALR")?.id).toBe("alr");
    expect(governedRuleForObligation([alrRule, pchRule], "staff-training", "PCH")?.id).toBe("pch");
  });

  it("attaches no rule when no facility program is in scope", () => {
    expect(governedRuleForObligation([pchRule, alrRule], "staff-training", null)).toBeNull();
    const rows = buildRegulatoryCrosswalkRows({ today: "2026-08-05" }, "org_admin", [pchRule, alrRule]);
    expect(rows.every((row) => row.governedRule === null)).toBe(true);
  });

  it("treats a rule that names no facility type as covering both programs", () => {
    const anyProgram = rule({
      id: "any",
      applicability: { stateCodes: ["PA"], crosswalkObligationId: "staff-training" },
    });
    expect(governedRuleForObligation([anyProgram], "staff-training", "PCH")?.id).toBe("any");
    expect(governedRuleForObligation([anyProgram], "staff-training", "ALR")?.id).toBe("any");
  });

  it("marks the row governed for the selected program only", () => {
    const pchRows = buildRegulatoryCrosswalkRows({ today: "2026-08-05" }, "org_admin", [pchRule, alrRule], "PCH");
    expect(pchRows.find((row) => row.id === "staff-training")?.citation).toBe("55 Pa. Code 2600.65");
    const alrRows = buildRegulatoryCrosswalkRows({ today: "2026-08-05" }, "org_admin", [pchRule, alrRule], "ALR");
    expect(alrRows.find((row) => row.id === "staff-training")?.citation).toBe("55 Pa. Code 2800.65");
  });

  it("counts only ACTIVE versions as installed jurisdiction coverage", () => {
    const superseded = rule({ id: "old", state: "superseded", applicability: { stateCodes: ["PA"] } });
    const ohio = rule({ id: "oh", applicability: { stateCodes: ["OH"] } });
    expect(activeRulePacksForJurisdiction([pchRule, superseded, ohio], "PA").map((r) => r.id)).toEqual(["pch"]);
    expect(activeRulePacksForJurisdiction([superseded, ohio], "PA")).toEqual([]);
    expect(activeRulePacksForJurisdiction(undefined, "PA")).toEqual([]);
  });
});
