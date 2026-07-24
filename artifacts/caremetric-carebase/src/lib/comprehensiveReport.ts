// Pure, side-effect-free composition of the "Comprehensive Report" -- the single, print-first
// document that pulls a point-in-time snapshot across every facet of the app (compliance,
// training, workforce, operations, incidents, residents, evidence, alerts) into one place.
//
// The page component (pages/app/ComprehensiveReport.tsx) is responsible for fetching each facet's
// existing summary RPC and normalizing the two operations-command-center shapes (portfolio vs.
// single-facility) into `OperationsReportModel`. Everything below is pure so it can be unit tested
// without a Supabase client or React tree -- see comprehensiveReport.test.ts.
//
// Terminology note (see repo CLAUDE.md): user-facing labels never say "ALR"/"Assisted Living
// Residence" -- facility-type labels are rendered through `facilityTypeDisplay` below, which mirrors
// the canonical labels in facilityTypes.ts (notably "ALR" -> "Assisted Living Facility (ALF)"). No
// literal "ALR" strings are produced here.

import type { OrgDashboardSummary } from "@/hooks/useDashboardSummary";
import type { IncidentAnalyticsSummary } from "@/lib/incidentAnalytics";
import type { ResidentComplianceAnalyticsSummary } from "@/lib/residentComplianceAnalytics";
import type {
  ComplaintListSummary,
  ConfidentialIntakeListSummary,
  EvidenceCollectionListSummary,
  WorkItemListSummary,
} from "@/hooks/useDomainListSummaries";

export type MetricTone = "default" | "primary" | "success" | "warning" | "danger" | "info";

export interface ReportMetric {
  label: string;
  value: string;
  tone?: MetricTone;
  /** Small supporting line under the value. */
  hint?: string;
}

export interface ReportTable {
  columns: string[];
  rows: string[][];
}

export interface ReportSectionData {
  id: ReportFacet;
  title: string;
  description?: string;
  /** Regulation / framework reference shown as a chip, when applicable. */
  reference?: string;
  metrics: ReportMetric[];
  table?: ReportTable;
  /**
   * False when the facet's data could not be loaded (RPC error / not entitled). The page still
   * renders the section heading so the printed document's structure is stable, but shows an
   * "unavailable" note instead of zeroes that would read as real "all clear" figures.
   */
  available: boolean;
  /** Present only when `available` is false: a short human explanation. */
  unavailableReason?: string;
}

export interface ComprehensiveReport {
  executive: ReportMetric[];
  sections: ReportSectionData[];
}

/** Normalized operations snapshot -- the page maps either command-center RPC shape onto this. */
export interface OperationsReportModel {
  scopeLabel: string;
  workforceGaps: number;
  residentReadinessGaps: number;
  activeEmergencyEvents: number;
  emergencyUnaccounted: number;
  highRiskWorkOrders: number;
  activeResidents: number;
  openWork: number;
  urgentWork: number;
  overdueWork: number;
  unassignedWork: number;
  // Single-facility command center exposes these; portfolio does not.
  pendingApproval?: number;
  medicationFollowUps?: number;
  incidentComplaintOpen?: number;
  overdueCorrectiveActions?: number;
  overduePolicyAttestations?: number;
  // Portfolio command center exposes these; single-facility does not.
  facilityCounts?: { critical: number; attention: number; ready: number };
  facilityReadiness?: { name: string; type: string; status: string; riskScore: number }[];
  // Single-facility command center exposes the per-source work breakdown.
  sourceBreakdown?: { sourceType: string; openCount: number; urgentCount: number; overdueCount: number }[];
}

export interface WorkforceReportModel {
  annualizedTurnoverRate: number | null;
  ninetyDayRetentionRate: number | null;
  averageTenureDays: number | null;
  currentHeadcount: number;
}

export interface ComprehensiveReportInputs {
  dashboard?: OrgDashboardSummary | null;
  operations?: OperationsReportModel | null;
  workforce?: WorkforceReportModel | null;
  incidents?: IncidentAnalyticsSummary | null;
  complaints?: ComplaintListSummary | null;
  confidential?: ConfidentialIntakeListSummary | null;
  residents?: ResidentComplianceAnalyticsSummary | null;
  evidence?: EvidenceCollectionListSummary | null;
  workItems?: WorkItemListSummary | null;
  /** True for orgs that run PCH / ALF facilities -- gates the resident-census section. */
  includeResidents?: boolean;
  /** Marks a facet whose RPC errored, so the section renders as unavailable rather than as zeroes. */
  errored?: Partial<Record<ReportFacet, boolean>>;
}

export type ReportFacet =
  | "compliance"
  | "training"
  | "workforce"
  | "facilities"
  | "operations"
  | "incidents"
  | "residents"
  | "documentation"
  | "alerts";

export const REPORT_FACETS: { id: ReportFacet; title: string }[] = [
  { id: "compliance", title: "Training Compliance" },
  { id: "training", title: "Training Readiness" },
  { id: "workforce", title: "Workforce & Retention" },
  { id: "facilities", title: "Facilities" },
  { id: "operations", title: "Operations Command Center" },
  { id: "incidents", title: "Incidents, Complaints & Confidential Reports" },
  { id: "residents", title: "Residents & Census" },
  { id: "documentation", title: "Documentation & Evidence" },
  { id: "alerts", title: "Active Compliance Alerts" },
];

function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

/** Green ≥90, amber ≥75, red below -- the same banding the dashboard uses for compliance scores. */
export function complianceTone(percentage: number | null | undefined): MetricTone {
  if (percentage === null || percentage === undefined || Number.isNaN(percentage)) return "default";
  if (percentage >= 90) return "success";
  if (percentage >= 75) return "warning";
  return "danger";
}

/** A count where zero is good (open risks): 0 → success, small → warning, larger → danger. */
function riskTone(count: number, warnAt = 1, dangerAt = 5): MetricTone {
  if (count <= 0) return "success";
  if (count < dangerAt && count >= warnAt) return "warning";
  return count >= dangerAt ? "danger" : "warning";
}

function unavailable(id: ReportFacet, title: string, description: string, reference?: string): ReportSectionData {
  return {
    id,
    title,
    description,
    reference,
    metrics: [],
    available: false,
    unavailableReason: "This data could not be loaded for the current scope, or the module is not enabled.",
  };
}

export function buildComprehensiveReport(inputs: ComprehensiveReportInputs): ComprehensiveReport {
  const errored = inputs.errored ?? {};
  const sections: ReportSectionData[] = [];

  // --- Training Compliance --------------------------------------------------------------------
  if (inputs.dashboard && !errored.compliance) {
    const c = inputs.dashboard.compliance;
    sections.push({
      id: "compliance",
      title: "Training Compliance",
      description: "Tracked training requirements and their current compliance status across staff.",
      reference: "55 Pa. Code §2600 / §2800",
      available: true,
      metrics: [
        { label: "Overall compliance", value: fmtPct(c.compliancePercentage), tone: complianceTone(c.compliancePercentage) },
        { label: "Compliant records", value: fmtInt(c.compliantCount), tone: "success" },
        { label: "Due soon (90 days)", value: fmtInt(c.dueSoon90Count), tone: riskTone(c.dueSoon90Count, 1, 10) },
        { label: "Expired", value: fmtInt(c.expiredCount), tone: riskTone(c.expiredCount) },
        { label: "Missing", value: fmtInt(c.missingCount), tone: riskTone(c.missingCount) },
        { label: "Missing documentation", value: fmtInt(c.missingDocumentCount), tone: riskTone(c.missingDocumentCount) },
        { label: "Total tracked", value: fmtInt(c.totalTrackedCount) },
      ],
    });
  } else {
    sections.push(unavailable("compliance", "Training Compliance", "Tracked training requirements and their compliance status.", "55 Pa. Code §2600 / §2800"));
  }

  // --- Training Readiness (near-term windows + trainer coverage) ------------------------------
  if (inputs.dashboard && !errored.training) {
    const c = inputs.dashboard.compliance;
    const s = inputs.dashboard.staff;
    sections.push({
      id: "training",
      title: "Training Readiness",
      description: "Near-term renewal workload and the trainers/med-admin staff who keep the program running.",
      reference: "55 Pa. Code §2600.65 / §2600.77",
      available: true,
      metrics: [
        { label: "Due within 30 days", value: fmtInt(c.dueSoon30Count), tone: riskTone(c.dueSoon30Count, 1, 10) },
        { label: "Due within 90 days", value: fmtInt(c.dueSoon90Count), tone: riskTone(c.dueSoon90Count, 1, 20) },
        { label: "Employees", value: fmtInt(s.totalEmployees) },
        { label: "Med-admin staff", value: fmtInt(s.totalMedAdminStaff) },
        { label: "Trainers due for recert", value: fmtInt(s.trainersDueForRecert), tone: riskTone(s.trainersDueForRecert) },
      ],
    });
  } else {
    sections.push(unavailable("training", "Training Readiness", "Near-term renewal workload and trainer coverage.", "55 Pa. Code §2600.65 / §2600.77"));
  }

  // --- Workforce & Retention ------------------------------------------------------------------
  if (inputs.workforce && !errored.workforce) {
    const w = inputs.workforce;
    sections.push({
      id: "workforce",
      title: "Workforce & Retention",
      description: "Trailing-12-month turnover and retention signals for staffing stability.",
      available: true,
      metrics: [
        { label: "Current headcount", value: fmtInt(w.currentHeadcount) },
        {
          label: "Annualized turnover",
          value: fmtPct(w.annualizedTurnoverRate),
          tone: w.annualizedTurnoverRate == null ? "default" : w.annualizedTurnoverRate <= 30 ? "success" : w.annualizedTurnoverRate <= 50 ? "warning" : "danger",
        },
        {
          label: "90-day retention",
          value: fmtPct(w.ninetyDayRetentionRate),
          tone: w.ninetyDayRetentionRate == null ? "default" : w.ninetyDayRetentionRate >= 80 ? "success" : w.ninetyDayRetentionRate >= 60 ? "warning" : "danger",
        },
        { label: "Average tenure (days)", value: fmtInt(w.averageTenureDays) },
      ],
    });
  } else {
    sections.push(unavailable("workforce", "Workforce & Retention", "Turnover and retention signals for staffing stability."));
  }

  // --- Facilities -----------------------------------------------------------------------------
  if (inputs.dashboard && !errored.facilities) {
    const facilities = inputs.dashboard.facilities ?? [];
    const active = facilities.filter((f) => f.isActive).length;
    const avgScore = facilities.length > 0 ? facilities.reduce((sum, f) => sum + (f.complianceScore ?? 0), 0) / facilities.length : null;
    sections.push({
      id: "facilities",
      title: "Facilities",
      description: "Every facility in scope with its licensure and current compliance score.",
      available: true,
      metrics: [
        { label: "Facilities", value: fmtInt(facilities.length) },
        { label: "Active", value: fmtInt(active) },
        { label: "Average compliance", value: fmtPct(avgScore), tone: complianceTone(avgScore) },
      ],
      table: {
        columns: ["Facility", "Type", "License #", "Status", "Compliance"],
        rows: facilities.map((f) => [
          f.name,
          facilityTypeDisplay(f.facilityType),
          f.licenseNumber || "—",
          f.isActive ? "Active" : "Inactive",
          fmtPct(f.complianceScore),
        ]),
      },
    });
  } else {
    sections.push(unavailable("facilities", "Facilities", "Facilities in scope with licensure and compliance scores."));
  }

  // --- Operations Command Center --------------------------------------------------------------
  if (inputs.operations && !errored.operations) {
    const o = inputs.operations;
    const metrics: ReportMetric[] = [
      { label: "Open work items", value: fmtInt(o.openWork), tone: riskTone(o.openWork, 1, 25) },
      { label: "Urgent work", value: fmtInt(o.urgentWork), tone: riskTone(o.urgentWork, 1, 5) },
      { label: "Overdue work", value: fmtInt(o.overdueWork), tone: riskTone(o.overdueWork) },
      { label: "Unassigned work", value: fmtInt(o.unassignedWork), tone: riskTone(o.unassignedWork, 1, 10) },
      { label: "Workforce gaps", value: fmtInt(o.workforceGaps), tone: riskTone(o.workforceGaps, 1, 10) },
      { label: "Resident readiness gaps", value: fmtInt(o.residentReadinessGaps), tone: riskTone(o.residentReadinessGaps, 1, 10) },
      { label: "High-risk work orders", value: fmtInt(o.highRiskWorkOrders), tone: riskTone(o.highRiskWorkOrders) },
      { label: "Active emergency events", value: fmtInt(o.activeEmergencyEvents), tone: riskTone(o.activeEmergencyEvents) },
      { label: "Emergency unaccounted", value: fmtInt(o.emergencyUnaccounted), tone: riskTone(o.emergencyUnaccounted) },
    ];
    if (o.pendingApproval !== undefined) metrics.push({ label: "Pending approval", value: fmtInt(o.pendingApproval), tone: riskTone(o.pendingApproval, 1, 10) });
    if (o.medicationFollowUps !== undefined) metrics.push({ label: "Medication follow-ups", value: fmtInt(o.medicationFollowUps), tone: riskTone(o.medicationFollowUps) });
    if (o.overdueCorrectiveActions !== undefined) metrics.push({ label: "Overdue corrective actions", value: fmtInt(o.overdueCorrectiveActions), tone: riskTone(o.overdueCorrectiveActions) });
    if (o.overduePolicyAttestations !== undefined) metrics.push({ label: "Overdue policy attestations", value: fmtInt(o.overduePolicyAttestations), tone: riskTone(o.overduePolicyAttestations, 1, 10) });
    if (o.facilityCounts) {
      metrics.push({ label: "Facilities needing attention", value: fmtInt(o.facilityCounts.attention + o.facilityCounts.critical), tone: riskTone(o.facilityCounts.attention + o.facilityCounts.critical) });
    }

    let table: ReportTable | undefined;
    if (o.facilityReadiness && o.facilityReadiness.length > 0) {
      table = {
        columns: ["Facility", "Type", "Readiness", "Risk score"],
        rows: o.facilityReadiness.map((f) => [f.name, facilityTypeDisplay(f.type), readinessLabel(f.status), fmtInt(f.riskScore)]),
      };
    } else if (o.sourceBreakdown && o.sourceBreakdown.length > 0) {
      table = {
        columns: ["Work source", "Open", "Urgent", "Overdue"],
        rows: o.sourceBreakdown.map((s) => [sourceTypeLabel(s.sourceType), fmtInt(s.openCount), fmtInt(s.urgentCount), fmtInt(s.overdueCount)]),
      };
    }

    sections.push({
      id: "operations",
      title: "Operations Command Center",
      description: `Cross-facet operational signals (${o.scopeLabel}): open work, staffing, resident readiness, emergencies, and equipment.`,
      available: true,
      metrics,
      table,
    });
  } else {
    sections.push(unavailable("operations", "Operations Command Center", "Cross-facet operational signals: work, staffing, emergencies, equipment."));
  }

  // --- Incidents, Complaints & Confidential Reports -------------------------------------------
  if ((inputs.incidents || inputs.complaints || inputs.confidential) && !errored.incidents) {
    const metrics: ReportMetric[] = [];
    if (inputs.incidents) {
      const i = inputs.incidents;
      metrics.push(
        { label: "Incidents (total)", value: fmtInt(i.total) },
        { label: "Open incidents", value: fmtInt(i.open), tone: riskTone(i.open, 1, 10) },
        { label: "Critical open", value: fmtInt(i.criticalOpen), tone: riskTone(i.criticalOpen) },
        { label: "Reported (30 days)", value: fmtInt(i.reportedLast30Days) },
      );
    }
    if (inputs.complaints) {
      const c = inputs.complaints;
      metrics.push(
        { label: "Open complaints", value: fmtInt(c.openCases), tone: riskTone(c.openCases, 1, 10) },
        { label: "Awaiting acknowledgement", value: fmtInt(c.awaitingAcknowledgement), tone: riskTone(c.awaitingAcknowledgement) },
        { label: "High / imminent risk", value: fmtInt(c.highOrImminentRisk), tone: riskTone(c.highOrImminentRisk) },
      );
    }
    if (inputs.confidential) {
      const cf = inputs.confidential;
      metrics.push(
        { label: "Confidential reports", value: fmtInt(cf.total) },
        { label: "Awaiting triage", value: fmtInt(cf.awaitingTriage), tone: riskTone(cf.awaitingTriage) },
        { label: "Confidential critical open", value: fmtInt(cf.criticalOpen), tone: riskTone(cf.criticalOpen) },
      );
    }
    sections.push({
      id: "incidents",
      title: "Incidents, Complaints & Confidential Reports",
      description: "Reportable events, grievances, and confidential intake with outstanding follow-up.",
      reference: "55 Pa. Code §2600.16 / §2800.16",
      available: true,
      metrics,
    });
  } else {
    sections.push(unavailable("incidents", "Incidents, Complaints & Confidential Reports", "Reportable events, grievances, and confidential intake.", "55 Pa. Code §2600.16 / §2800.16"));
  }

  // --- Residents & Census (PCH / ALF only) ----------------------------------------------------
  if (inputs.includeResidents) {
    if (inputs.residents && !errored.residents) {
      const r = inputs.residents;
      sections.push({
        id: "residents",
        title: "Residents & Census",
        description: "Census and resident-record readiness (assessments, agreements, and required documentation).",
        reference: "55 Pa. Code §2600.224 / §2800.225",
        available: true,
        metrics: [
          { label: "Residents", value: fmtInt(r.residents) },
          { label: "Active residents", value: fmtInt(r.activeResidents) },
          { label: "Residents with open items", value: fmtInt(r.residentsWithOpenItems), tone: riskTone(r.residentsWithOpenItems, 1, 10) },
          { label: "Expired items", value: fmtInt(r.expiredItems), tone: riskTone(r.expiredItems) },
          { label: "Missing items", value: fmtInt(r.missingItems), tone: riskTone(r.missingItems) },
          { label: "Due soon", value: fmtInt(r.dueSoonItems), tone: riskTone(r.dueSoonItems, 1, 10) },
          { label: "Due within 14 days", value: fmtInt(r.dueWithin14Days), tone: riskTone(r.dueWithin14Days) },
        ],
      });
    } else {
      sections.push(unavailable("residents", "Residents & Census", "Census and resident-record readiness.", "55 Pa. Code §2600.224 / §2800.225"));
    }
  }

  // --- Documentation & Evidence ---------------------------------------------------------------
  if ((inputs.evidence || inputs.workItems || inputs.dashboard) && !errored.documentation) {
    const metrics: ReportMetric[] = [];
    if (inputs.evidence) {
      const e = inputs.evidence;
      metrics.push(
        { label: "Evidence collections", value: fmtInt(e.total) },
        { label: "Published", value: fmtInt(e.published), tone: "success" },
        { label: "Draft", value: fmtInt(e.draft) },
        { label: "Legal holds", value: fmtInt(e.legalHolds), tone: e.legalHolds > 0 ? "warning" : "default" },
      );
    }
    if (inputs.dashboard) {
      metrics.push({ label: "Recent uploads", value: fmtInt(inputs.dashboard.uploads.recentCount) });
    }
    if (inputs.workItems) {
      metrics.push(
        { label: "Open work items", value: fmtInt(inputs.workItems.open), tone: riskTone(inputs.workItems.open, 1, 25) },
        { label: "Overdue work items", value: fmtInt(inputs.workItems.overdue), tone: riskTone(inputs.workItems.overdue) },
      );
    }
    let table: ReportTable | undefined;
    const recent = inputs.dashboard?.uploads.recent ?? [];
    if (recent.length > 0) {
      table = {
        columns: ["Document", "Type", "Uploaded"],
        rows: recent.map((u) => [u.fileName, humanize(u.documentType), formatDay(u.createdAt)]),
      };
    }
    sections.push({
      id: "documentation",
      title: "Documentation & Evidence",
      description: "Evidence collections, legal holds, and recent record uploads supporting survey readiness.",
      available: true,
      metrics,
      table,
    });
  } else {
    sections.push(unavailable("documentation", "Documentation & Evidence", "Evidence collections, legal holds, and recent uploads."));
  }

  // --- Active Compliance Alerts ---------------------------------------------------------------
  if (inputs.dashboard && !errored.alerts) {
    const a = inputs.dashboard.alerts;
    sections.push({
      id: "alerts",
      title: "Active Compliance Alerts",
      description: "Open, system-generated compliance alerts and their severity.",
      available: true,
      metrics: [
        { label: "Open alerts", value: fmtInt(a.openCount), tone: riskTone(a.openCount, 1, 10) },
        { label: "Critical alerts", value: fmtInt(a.criticalCount), tone: riskTone(a.criticalCount) },
      ],
      table:
        (a.recent ?? []).length > 0
          ? {
              columns: ["Severity", "Alert", "Detail"],
              rows: a.recent.map((alert) => [humanize(alert.severity), alert.title, alert.message || "—"]),
            }
          : undefined,
    });
  } else {
    sections.push(unavailable("alerts", "Active Compliance Alerts", "Open, system-generated compliance alerts and severity."));
  }

  return { executive: buildExecutiveSummary(inputs), sections };
}

/** The top-of-report KPI strip -- the handful of numbers a reader wants before any section. */
function buildExecutiveSummary(inputs: ComprehensiveReportInputs): ReportMetric[] {
  const metrics: ReportMetric[] = [];
  const c = inputs.dashboard?.compliance;
  if (c) {
    metrics.push({ label: "Overall compliance", value: fmtPct(c.compliancePercentage), tone: complianceTone(c.compliancePercentage) });
    metrics.push({ label: "Expired / missing", value: fmtInt(c.expiredCount + c.missingCount), tone: riskTone(c.expiredCount + c.missingCount) });
  }
  if (inputs.dashboard?.staff) {
    metrics.push({ label: "Employees", value: fmtInt(inputs.dashboard.staff.totalEmployees) });
  }
  if (inputs.dashboard?.facilities) {
    metrics.push({ label: "Facilities", value: fmtInt(inputs.dashboard.facilities.length) });
  }
  if (inputs.dashboard?.alerts) {
    metrics.push({ label: "Open alerts", value: fmtInt(inputs.dashboard.alerts.openCount), tone: riskTone(inputs.dashboard.alerts.openCount, 1, 10) });
  }
  if (inputs.incidents) {
    metrics.push({ label: "Open incidents", value: fmtInt(inputs.incidents.open), tone: riskTone(inputs.incidents.open, 1, 10) });
  }
  if (inputs.operations) {
    metrics.push({ label: "Open work items", value: fmtInt(inputs.operations.openWork), tone: riskTone(inputs.operations.openWork, 1, 25) });
  }
  if (inputs.includeResidents && inputs.residents) {
    metrics.push({ label: "Active residents", value: fmtInt(inputs.residents.activeResidents) });
  }
  return metrics;
}

// --- small display helpers (kept here so they're covered by the builder's unit tests) ----------

/**
 * Facility-type display label. Mirrors facilityTypes.ts's canonical labels -- notably "ALR" →
 * "Assisted Living Facility (ALF)" per the org's terminology rule -- while tolerating unknown codes.
 */
export function facilityTypeDisplay(facilityType: string | null | undefined): string {
  switch (facilityType) {
    case "PCH":
      return "Personal Care Home (PCH)";
    case "ALR":
      return "Assisted Living Facility (ALF)";
    case "NH":
      return "Skilled Nursing Facility (SNF/NH)";
    case "HHA":
      return "Home Health Agency (HHA)";
    case "HOS":
      return "Hospice Agency (HOS)";
    case "GH":
      return "Group Home (GH)";
    default:
      return facilityType || "—";
  }
}

function readinessLabel(status: string): string {
  switch (status) {
    case "critical":
      return "Critical";
    case "attention":
      return "Needs attention";
    case "ready":
      return "Ready";
    default:
      return humanize(status);
  }
}

function sourceTypeLabel(sourceType: string): string {
  return humanize(sourceType);
}

function humanize(value: string): string {
  if (!value) return "—";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatDay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
