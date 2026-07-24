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
  /**
   * The data scope this section actually reflects, e.g. "Organization-wide (all facilities)", a
   * facility name, or "All PCH/ALF facilities". Rendered as a badge so a facility-labeled report is
   * never mistaken for facility-specific when its underlying source is organization-level.
   */
  scope?: string;
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
  /**
   * A caveat shown even when the section is available: a partial-source failure (one contributing
   * RPC errored while another succeeded) or a coverage limitation (e.g. portfolio operations
   * excludes non-PCH/ALF facilities). Surfacing it stops readers reading an incomplete section as a
   * complete all-clear snapshot.
   */
  warning?: string;
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
  // Portfolio command center exposes these; single-facility does not. Its presence is also how the
  // builder tells the two shapes apart (portfolio is PCH/ALF-only; see the operations section).
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

/**
 * Per-source error flags. Each corresponds to one summary RPC. Facets backed by a single source go
 * unavailable when their source errors; multi-source facets (incidents, documentation) stay
 * available on a partial failure and carry a `warning` naming what could not be loaded.
 */
export interface ComprehensiveReportSourceErrors {
  dashboard?: boolean;
  operations?: boolean;
  workforce?: boolean;
  incidents?: boolean;
  complaints?: boolean;
  confidential?: boolean;
  residents?: boolean;
  evidence?: boolean;
  workItems?: boolean;
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
  /**
   * Name of the single facility the report is scoped to, or undefined for the organization-wide
   * ("All facilities") view. Used only for scope labeling -- the page is responsible for actually
   * passing the facility id to the facility-scoped RPCs.
   */
  facilityScopeName?: string;
  /**
   * True when the organization runs facilities outside PCH/ALF. The portfolio operations snapshot
   * only covers PCH/ALF facilities, so this drives a coverage caveat on that section.
   */
  orgHasOtherFacilityTypes?: boolean;
  /** Per-source RPC error flags (see ComprehensiveReportSourceErrors). */
  errors?: ComprehensiveReportSourceErrors;
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

function unavailable(
  id: ReportFacet,
  title: string,
  description: string,
  reference?: string,
): ReportSectionData {
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

/** "Some data could not be loaded (X, Y)" when a subset of a section's sources errored. */
function partialWarning(failedLabels: string[], anySucceeded: boolean): string | undefined {
  if (failedLabels.length === 0 || !anySucceeded) return undefined;
  return `Some data could not be loaded (${failedLabels.join(", ")}); the figures below may be incomplete.`;
}

export function buildComprehensiveReport(inputs: ComprehensiveReportInputs): ComprehensiveReport {
  const errors = inputs.errors ?? {};
  const sections: ReportSectionData[] = [];

  // Dashboard-backed sections come from get_org_dashboard_summary, which has no facility argument --
  // it is always organization-wide (RLS-scoped to what the caller can see). When a single facility
  // is selected we say so explicitly rather than let org-wide numbers read as facility-specific.
  const orgWideScope = inputs.facilityScopeName ? "Organization-wide (all facilities)" : "All facilities";
  // Facility-scoped sections (operations single-facility, incidents, residents, evidence, work
  // items, workforce) genuinely honor the facility filter.
  const facilityScope = inputs.facilityScopeName ?? "All facilities";

  // --- Training Compliance --------------------------------------------------------------------
  if (inputs.dashboard && !errors.dashboard) {
    const c = inputs.dashboard.compliance;
    sections.push({
      id: "compliance",
      title: "Training Compliance",
      description: "Tracked training requirements and their current compliance status across staff.",
      reference: "55 Pa. Code §2600 / §2800",
      scope: orgWideScope,
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
  if (inputs.dashboard && !errors.dashboard) {
    const c = inputs.dashboard.compliance;
    const s = inputs.dashboard.staff;
    sections.push({
      id: "training",
      title: "Training Readiness",
      description: "Near-term renewal workload and the trainers/med-admin staff who keep the program running.",
      reference: "55 Pa. Code §2600.65 / §2600.77",
      scope: orgWideScope,
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
  if (inputs.workforce && !errors.workforce) {
    const w = inputs.workforce;
    sections.push({
      id: "workforce",
      title: "Workforce & Retention",
      description: "Trailing-12-month turnover and retention signals for staffing stability.",
      scope: facilityScope,
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
  if (inputs.dashboard && !errors.dashboard) {
    const facilities = inputs.dashboard.facilities ?? [];
    const active = facilities.filter((f) => f.isActive).length;
    const avgScore = facilities.length > 0 ? facilities.reduce((sum, f) => sum + (f.complianceScore ?? 0), 0) / facilities.length : null;
    sections.push({
      id: "facilities",
      title: "Facilities",
      description: "Every facility in scope with its licensure and current compliance score.",
      scope: orgWideScope,
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
  if (inputs.operations && !errors.operations) {
    const o = inputs.operations;
    const isPortfolio = !!o.facilityCounts;
    // The portfolio command-center RPC only includes active PCH/ALF facilities, so labeling it
    // "Organization-wide" would over-claim for a mixed or non-PCH/ALF org. Single-facility scope
    // uses whatever facility name the page passed as scopeLabel.
    const opsScope = isPortfolio ? "All PCH/ALF facilities" : o.scopeLabel;
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
      description: "Cross-facet operational signals: open work, staffing, resident readiness, emergencies, and equipment.",
      scope: opsScope,
      warning: isPortfolio && inputs.orgHasOtherFacilityTypes
        ? "The portfolio operations snapshot covers PCH/ALF facilities only; work at other facility types is not included."
        : undefined,
      available: true,
      metrics,
      table,
    });
  } else {
    sections.push(unavailable("operations", "Operations Command Center", "Cross-facet operational signals: work, staffing, emergencies, equipment."));
  }

  // --- Incidents, Complaints & Confidential Reports (multi-source; partial failures surfaced) --
  {
    const incidentsOk = !!inputs.incidents && !errors.incidents;
    const complaintsOk = !!inputs.complaints && !errors.complaints;
    const confidentialOk = !!inputs.confidential && !errors.confidential;
    const anyOk = incidentsOk || complaintsOk || confidentialOk;
    if (anyOk) {
      const metrics: ReportMetric[] = [];
      if (incidentsOk) {
        const i = inputs.incidents!;
        metrics.push(
          { label: "Incidents (total)", value: fmtInt(i.total) },
          { label: "Open incidents", value: fmtInt(i.open), tone: riskTone(i.open, 1, 10) },
          { label: "Critical open", value: fmtInt(i.criticalOpen), tone: riskTone(i.criticalOpen) },
          { label: "Reported (30 days)", value: fmtInt(i.reportedLast30Days) },
        );
      }
      if (complaintsOk) {
        const c = inputs.complaints!;
        metrics.push(
          { label: "Open complaints", value: fmtInt(c.openCases), tone: riskTone(c.openCases, 1, 10) },
          { label: "Awaiting acknowledgement", value: fmtInt(c.awaitingAcknowledgement), tone: riskTone(c.awaitingAcknowledgement) },
          { label: "High / imminent risk", value: fmtInt(c.highOrImminentRisk), tone: riskTone(c.highOrImminentRisk) },
        );
      }
      if (confidentialOk) {
        const cf = inputs.confidential!;
        metrics.push(
          { label: "Confidential reports", value: fmtInt(cf.total) },
          { label: "Awaiting triage", value: fmtInt(cf.awaitingTriage), tone: riskTone(cf.awaitingTriage) },
          { label: "Confidential critical open", value: fmtInt(cf.criticalOpen), tone: riskTone(cf.criticalOpen) },
        );
      }
      const failed: string[] = [];
      if (errors.incidents) failed.push("incidents");
      if (errors.complaints) failed.push("complaints");
      if (errors.confidential) failed.push("confidential reports");
      sections.push({
        id: "incidents",
        title: "Incidents, Complaints & Confidential Reports",
        description: "Reportable events, grievances, and confidential intake with outstanding follow-up.",
        reference: "55 Pa. Code §2600.16 / §2800.16",
        scope: facilityScope,
        warning: partialWarning(failed, true),
        available: true,
        metrics,
      });
    } else {
      sections.push(unavailable("incidents", "Incidents, Complaints & Confidential Reports", "Reportable events, grievances, and confidential intake.", "55 Pa. Code §2600.16 / §2800.16"));
    }
  }

  // --- Residents & Census (PCH / ALF only) ----------------------------------------------------
  if (inputs.includeResidents) {
    if (inputs.residents && !errors.residents) {
      const r = inputs.residents;
      sections.push({
        id: "residents",
        title: "Residents & Census",
        description: "Census and resident-record readiness (assessments, agreements, and required documentation).",
        reference: "55 Pa. Code §2600.224 / §2800.225",
        scope: facilityScope,
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

  // --- Documentation & Evidence (multi-source; partial failures surfaced) ----------------------
  {
    const evidenceOk = !!inputs.evidence && !errors.evidence;
    const workItemsOk = !!inputs.workItems && !errors.workItems;
    // Recent uploads come from the org-wide dashboard summary, so only include them in the "All
    // facilities" view -- for a single-facility report they would inject organization-wide rows.
    const uploadsOk = !!inputs.dashboard && !errors.dashboard && !inputs.facilityScopeName;
    const anyOk = evidenceOk || workItemsOk || uploadsOk;
    if (anyOk) {
      const metrics: ReportMetric[] = [];
      if (evidenceOk) {
        const e = inputs.evidence!;
        metrics.push(
          { label: "Evidence collections", value: fmtInt(e.total) },
          { label: "Published", value: fmtInt(e.published), tone: "success" },
          { label: "Draft", value: fmtInt(e.draft) },
          { label: "Legal holds", value: fmtInt(e.legalHolds), tone: e.legalHolds > 0 ? "warning" : "default" },
        );
      }
      if (uploadsOk) {
        metrics.push({ label: "Recent uploads", value: fmtInt(inputs.dashboard!.uploads.recentCount) });
      }
      if (workItemsOk) {
        metrics.push(
          { label: "Open work items", value: fmtInt(inputs.workItems!.open), tone: riskTone(inputs.workItems!.open, 1, 25) },
          { label: "Overdue work items", value: fmtInt(inputs.workItems!.overdue), tone: riskTone(inputs.workItems!.overdue) },
        );
      }
      let table: ReportTable | undefined;
      const recent = uploadsOk ? inputs.dashboard!.uploads.recent ?? [] : [];
      if (recent.length > 0) {
        table = {
          columns: ["Document", "Type", "Uploaded"],
          rows: recent.map((u) => [u.fileName, humanize(u.documentType), formatDay(u.createdAt)]),
        };
      }
      const failed: string[] = [];
      if (errors.evidence) failed.push("evidence collections");
      if (errors.workItems) failed.push("work items");
      sections.push({
        id: "documentation",
        title: "Documentation & Evidence",
        description: "Evidence collections, legal holds, and recent record uploads supporting survey readiness.",
        scope: facilityScope,
        warning: partialWarning(failed, true),
        available: true,
        metrics,
        table,
      });
    } else {
      sections.push(unavailable("documentation", "Documentation & Evidence", "Evidence collections, legal holds, and recent uploads."));
    }
  }

  // --- Active Compliance Alerts ---------------------------------------------------------------
  if (inputs.dashboard && !errors.dashboard) {
    const a = inputs.dashboard.alerts;
    sections.push({
      id: "alerts",
      title: "Active Compliance Alerts",
      description: "Open, system-generated compliance alerts and their severity.",
      scope: orgWideScope,
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

  return { executive: buildExecutiveSummary(inputs, errors), sections };
}

/**
 * The top-of-report KPI strip -- the handful of numbers a reader wants before any section. Honors
 * the same per-source error flags the sections do, so a KPI is never printed from a facet the body
 * has already marked unavailable (e.g. stale data left in cache after a failed refetch).
 */
function buildExecutiveSummary(
  inputs: ComprehensiveReportInputs,
  errors: ComprehensiveReportSourceErrors,
): ReportMetric[] {
  const metrics: ReportMetric[] = [];
  const dashboardOk = inputs.dashboard && !errors.dashboard;
  if (dashboardOk) {
    const c = inputs.dashboard!.compliance;
    metrics.push({ label: "Overall compliance", value: fmtPct(c.compliancePercentage), tone: complianceTone(c.compliancePercentage) });
    metrics.push({ label: "Expired / missing", value: fmtInt(c.expiredCount + c.missingCount), tone: riskTone(c.expiredCount + c.missingCount) });
    metrics.push({ label: "Employees", value: fmtInt(inputs.dashboard!.staff.totalEmployees) });
    metrics.push({ label: "Facilities", value: fmtInt(inputs.dashboard!.facilities.length) });
    metrics.push({ label: "Open alerts", value: fmtInt(inputs.dashboard!.alerts.openCount), tone: riskTone(inputs.dashboard!.alerts.openCount, 1, 10) });
  }
  if (inputs.incidents && !errors.incidents) {
    metrics.push({ label: "Open incidents", value: fmtInt(inputs.incidents.open), tone: riskTone(inputs.incidents.open, 1, 10) });
  }
  if (inputs.operations && !errors.operations) {
    metrics.push({ label: "Open work items", value: fmtInt(inputs.operations.openWork), tone: riskTone(inputs.operations.openWork, 1, 25) });
  }
  if (inputs.includeResidents && inputs.residents && !errors.residents) {
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
