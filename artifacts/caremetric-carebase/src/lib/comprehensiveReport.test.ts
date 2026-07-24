import { describe, expect, it } from "vitest";
import {
  buildComprehensiveReport,
  complianceTone,
  facilityTypeDisplay,
  type ComprehensiveReportInputs,
} from "./comprehensiveReport";

function baseDashboard(): NonNullable<ComprehensiveReportInputs["dashboard"]> {
  return {
    compliance: {
      compliantCount: 180,
      dueSoonCount: 20,
      dueSoon30Count: 8,
      dueSoon90Count: 20,
      expiredCount: 5,
      missingCount: 3,
      missingDocumentCount: 2,
      totalTrackedCount: 210,
      compliancePercentage: 92,
    },
    staff: { totalEmployees: 60, totalMedAdminStaff: 18, trainersDueForRecert: 1 },
    alerts: {
      openCount: 4,
      criticalCount: 1,
      recent: [{ id: "a1", title: "Fire drill overdue", message: "Q3 drill not logged", severity: "critical" }],
    },
    uploads: {
      recentCount: 3,
      recent: [{ id: "u1", fileName: "cpr-cert.pdf", documentType: "certificate", createdAt: "2026-07-20T12:00:00.000Z" }],
    },
    facilities: [
      { id: "f1", name: "Maple House", facilityType: "PCH", licenseNumber: "PCH-123", isActive: true, complianceScore: 95 },
      { id: "f2", name: "Oak Residence", facilityType: "ALR", licenseNumber: null, isActive: false, complianceScore: 70 },
    ],
    generatedAt: "2026-07-24T00:00:00.000Z",
  };
}

function baseIncidents(): NonNullable<ComprehensiveReportInputs["incidents"]> {
  return {
    total: 12,
    open: 3,
    criticalOpen: 1,
    majorOrCritical: 2,
    reportedLast7Days: 1,
    reportedLast30Days: 4,
    oldestOpenIncidentId: null,
    topIncidentType: "fall",
  };
}

function fullInputs(): ComprehensiveReportInputs {
  return {
    dashboard: baseDashboard(),
    workforce: { annualizedTurnoverRate: 28, ninetyDayRetentionRate: 85, averageTenureDays: 540, currentHeadcount: 60 },
    operations: {
      scopeLabel: "Organization-wide",
      workforceGaps: 2,
      residentReadinessGaps: 4,
      activeEmergencyEvents: 0,
      emergencyUnaccounted: 0,
      highRiskWorkOrders: 1,
      activeResidents: 44,
      openWork: 30,
      urgentWork: 3,
      overdueWork: 2,
      unassignedWork: 5,
      facilityCounts: { critical: 1, attention: 1, ready: 0 },
      facilityReadiness: [{ name: "Maple House", type: "PCH", status: "attention", riskScore: 42 }],
    },
    incidents: baseIncidents(),
    complaints: { total: 5, openCases: 2, awaitingAcknowledgement: 1, highOrImminentRisk: 0, incidentLinked: 1 },
    confidential: { total: 2, awaitingTriage: 1, investigating: 1, criticalOpen: 0 },
    evidence: { total: 9, draft: 2, published: 7, legalHolds: 1 },
    workItems: { total: 40, open: 30, overdue: 2, blocked: 1, pendingApproval: 3 },
    residents: {
      residents: 50,
      activeResidents: 44,
      residentsWithOpenItems: 6,
      expiredItems: 2,
      missingItems: 1,
      dueSoonItems: 4,
      dueWithin14Days: 1,
      newestAdmissionResidentId: null,
    },
    includeResidents: true,
  };
}

describe("buildComprehensiveReport", () => {
  it("produces an executive KPI strip and every core section when all facets are present", () => {
    const report = buildComprehensiveReport(fullInputs());

    expect(report.executive.some((m) => m.label === "Overall compliance" && m.value === "92%")).toBe(true);
    expect(report.executive.some((m) => m.label === "Active residents" && m.value === "44")).toBe(true);

    const ids = report.sections.map((s) => s.id);
    expect(ids).toEqual([
      "compliance",
      "training",
      "workforce",
      "facilities",
      "operations",
      "incidents",
      "residents",
      "documentation",
      "alerts",
    ]);
    expect(report.sections.every((s) => s.available)).toBe(true);

    const facilities = report.sections.find((s) => s.id === "facilities");
    // ALR row must render the ALF label, never "ALR"/"Residence" as a type.
    expect(facilities?.table?.rows.some((r) => r.includes("Assisted Living Facility (ALF)"))).toBe(true);

    const operations = report.sections.find((s) => s.id === "operations");
    expect(operations?.table?.columns).toContain("Readiness");
    expect(operations?.table?.rows[0]).toContain("Needs attention");
  });

  it("labels dashboard-backed sections organization-wide when a single facility is selected", () => {
    const report = buildComprehensiveReport({ ...fullInputs(), facilityScopeName: "Maple House" });
    const compliance = report.sections.find((s) => s.id === "compliance");
    const incidents = report.sections.find((s) => s.id === "incidents");
    // Dashboard summary can't be facility-filtered -> flagged organization-wide, not "Maple House".
    expect(compliance?.scope).toBe("Organization-wide (all facilities)");
    // Facility-scoped sources reflect the selected facility.
    expect(incidents?.scope).toBe("Maple House");
  });

  it("labels the PCH/ALF-only portfolio operations snapshot and warns for mixed orgs", () => {
    const mixed = buildComprehensiveReport({ ...fullInputs(), orgHasOtherFacilityTypes: true });
    const operations = mixed.sections.find((s) => s.id === "operations");
    expect(operations?.scope).toBe("All PCH/ALF facilities");
    expect(operations?.warning).toMatch(/PCH\/ALF facilities only/i);

    const pureAlf = buildComprehensiveReport({ ...fullInputs(), orgHasOtherFacilityTypes: false });
    expect(pureAlf.sections.find((s) => s.id === "operations")?.warning).toBeUndefined();
  });

  it("omits the residents section unless includeResidents is set", () => {
    const withoutResidents = buildComprehensiveReport({ dashboard: baseDashboard() });
    expect(withoutResidents.sections.some((s) => s.id === "residents")).toBe(false);

    const withResidents = buildComprehensiveReport({ dashboard: baseDashboard(), includeResidents: true });
    const residents = withResidents.sections.find((s) => s.id === "residents");
    expect(residents).toBeDefined();
    // includeResidents but no data -> section present but unavailable, not fabricated zeroes.
    expect(residents?.available).toBe(false);
  });

  it("keeps a multi-source facet available on a partial failure and names what failed", () => {
    const report = buildComprehensiveReport({
      ...fullInputs(),
      errors: { confidential: true },
    });
    const incidents = report.sections.find((s) => s.id === "incidents");
    expect(incidents?.available).toBe(true);
    expect(incidents?.warning).toMatch(/confidential reports/i);
    // The failed source's metrics are omitted, the healthy ones remain.
    expect(incidents?.metrics.some((m) => m.label === "Open incidents")).toBe(true);
    expect(incidents?.metrics.some((m) => m.label === "Confidential reports")).toBe(false);
  });

  it("marks a multi-source facet unavailable only when every contributing source fails", () => {
    const report = buildComprehensiveReport({
      dashboard: baseDashboard(),
      incidents: baseIncidents(),
      errors: { incidents: true },
    });
    const incidents = report.sections.find((s) => s.id === "incidents");
    // incidents errored; complaints + confidential were never provided -> nothing to show.
    expect(incidents?.available).toBe(false);
    expect(incidents?.unavailableReason).toBeTruthy();
    expect(incidents?.metrics).toHaveLength(0);
  });

  it("honors source errors in the executive summary, not just the sections", () => {
    // Dashboard data present but its refetch errored: neither the compliance section nor the
    // executive KPI derived from it should print stale numbers.
    const report = buildComprehensiveReport({ ...fullInputs(), errors: { dashboard: true } });
    expect(report.sections.find((s) => s.id === "compliance")?.available).toBe(false);
    expect(report.executive.some((m) => m.label === "Overall compliance")).toBe(false);
    // A non-errored facet's KPI still appears.
    expect(report.executive.some((m) => m.label === "Open incidents")).toBe(true);
  });

  it("renders the single-facility work-source breakdown when portfolio readiness is absent", () => {
    const report = buildComprehensiveReport({
      dashboard: baseDashboard(),
      facilityScopeName: "Maple House",
      operations: {
        scopeLabel: "Maple House",
        workforceGaps: 0,
        residentReadinessGaps: 0,
        activeEmergencyEvents: 0,
        emergencyUnaccounted: 0,
        highRiskWorkOrders: 0,
        activeResidents: 20,
        openWork: 10,
        urgentWork: 1,
        overdueWork: 0,
        unassignedWork: 2,
        pendingApproval: 1,
        medicationFollowUps: 2,
        overdueCorrectiveActions: 0,
        overduePolicyAttestations: 1,
        sourceBreakdown: [
          { sourceType: "incident", openCount: 3, urgentCount: 1, overdueCount: 0 },
          { sourceType: "work_order", openCount: 4, urgentCount: 0, overdueCount: 0 },
        ],
      },
    });
    const operations = report.sections.find((s) => s.id === "operations");
    expect(operations?.scope).toBe("Maple House");
    expect(operations?.table?.columns).toEqual(["Work source", "Open", "Urgent", "Overdue"]);
    expect(operations?.table?.rows.some((r) => r[0] === "Work Order")).toBe(true);
    // single-facility-only metrics surface
    expect(operations?.metrics.some((m) => m.label === "Medication follow-ups")).toBe(true);
    expect(operations?.metrics.some((m) => m.label === "Overdue policy attestations")).toBe(true);
  });

  it("drops organization-wide recent uploads from a single-facility documentation section", () => {
    const orgWide = buildComprehensiveReport(fullInputs());
    expect(orgWide.sections.find((s) => s.id === "documentation")?.metrics.some((m) => m.label === "Recent uploads")).toBe(true);

    const facilityScoped = buildComprehensiveReport({ ...fullInputs(), facilityScopeName: "Maple House" });
    const doc = facilityScoped.sections.find((s) => s.id === "documentation");
    // Uploads are org-wide, so they must not appear under a single facility's documentation.
    expect(doc?.metrics.some((m) => m.label === "Recent uploads")).toBe(false);
    expect(doc?.metrics.some((m) => m.label === "Evidence collections")).toBe(true);
  });
});

describe("complianceTone", () => {
  it("bands scores green/amber/red the way the dashboard does", () => {
    expect(complianceTone(95)).toBe("success");
    expect(complianceTone(80)).toBe("warning");
    expect(complianceTone(50)).toBe("danger");
    expect(complianceTone(null)).toBe("default");
  });
});

describe("facilityTypeDisplay", () => {
  it("renders ALR as the ALF label per the org terminology rule", () => {
    expect(facilityTypeDisplay("ALR")).toBe("Assisted Living Facility (ALF)");
    expect(facilityTypeDisplay("PCH")).toBe("Personal Care Home (PCH)");
    expect(facilityTypeDisplay("ZZZ")).toBe("ZZZ");
    expect(facilityTypeDisplay(null)).toBe("—");
  });
});
