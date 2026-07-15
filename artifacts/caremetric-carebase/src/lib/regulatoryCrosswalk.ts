import type { Role } from "@/lib/auth";
import type { ActiveRegulatoryRule } from "@/hooks/useRegulatoryRules";

export type FacilityProgram = "PCH" | "ALR";
export type CrosswalkEvidenceSource =
  | "training"
  | "resident"
  | "incident"
  | "physical_site"
  | "policy"
  | "binder";
export type CrosswalkStatus = "inspection_ready" | "needs_attention" | "missing_evidence" | "overdue";

export interface RegulatoryObligation {
  id: string;
  citation: string;
  requirement: string;
  facilityTypes: FacilityProgram[];
  responsibleRole: string;
  evidenceSource: CrosswalkEvidenceSource;
  evidenceLabel: string;
  route: string;
  binderLocation: string;
}

export interface CrosswalkEvidenceInput {
  today: string;
  trainingRecords?: Array<{ status?: string | null; due_date?: string | null }>;
  credentials?: Array<{ status?: string | null; expiration_date?: string | null }>;
  residentItems?: Array<{ status?: string | null; due_date?: string | null; item_type?: string | null }>;
  incidents?: Array<{ status?: string | null; final_report_submitted_at?: string | null; occurred_at?: string | null }>;
  correctiveActions?: Array<{ status?: string | null; due_date?: string | null }>;
  inspectionItems?: Array<{ status?: string | null; due_date?: string | null }>;
  violations?: Array<{ status?: string | null; citation?: string | null }>;
  policyDocuments?: Array<{ current_version_id?: string | null }>;
  policyAttestations?: Array<{ status?: string | null; due_date?: string | null }>;
  evidenceCollections?: Array<{ status?: string | null; expires_at?: string | null }>;
}

export interface RegulatoryCrosswalkRow extends RegulatoryObligation {
  status: CrosswalkStatus;
  nextDueDate: string | null;
  evidenceCount: number;
  gapCount: number;
  canEdit: boolean;
  governedRule: ActiveRegulatoryRule | null;
}

export interface CrosswalkFilter {
  facilityType?: FacilityProgram | "all";
  citation?: string;
  status?: CrosswalkStatus | "all";
  evidenceSource?: CrosswalkEvidenceSource | "all";
}

export const REGULATORY_OBLIGATIONS: RegulatoryObligation[] = [
  {
    id: "staff-training",
    citation: "55 Pa. Code 2600/2800 — staff training",
    requirement: "Maintain role-specific orientation, annual training, competency, and retraining evidence for staff assigned to the home/residence.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Administrator / training coordinator",
    evidenceSource: "training",
    evidenceLabel: "Training records, courses, classes, competencies, med-admin roster, and employee credentials",
    route: "/app/training-matrix",
    binderLocation: "Staffing & Training / Training Matrix",
  },
  {
    id: "administrator-qualification",
    citation: "55 Pa. Code 2800.64 / Chapter 2600 administrator qualification",
    requirement: "Keep administrator qualification, orientation, approved-course/test, continuing education, and backup coverage evidence current.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Organization administrator",
    evidenceSource: "training",
    evidenceLabel: "Administrator qualification profiles, employee credentials, and continuing education records",
    route: "/app/administrator-qualification",
    binderLocation: "Staffing & Training / Administrator",
  },
  {
    id: "resident-assessment-support-plan",
    citation: "55 Pa. Code 2600.225/2600.227 and Chapter 2800 assessment/support plan",
    requirement: "Complete admission, annual, significant-change, and Department-requested assessment/support-plan items on state-approved forms.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Resident records lead",
    evidenceSource: "resident",
    evidenceLabel: "Residents, resident assessment forms, state forms, resident compliance items, and resident documents",
    route: "/app/state-forms",
    binderLocation: "Resident Records / Assessment & Support Plan",
  },
  {
    id: "resident-rights-grievances",
    citation: "55 Pa. Code 2600/2800 — resident rights and complaints",
    requirement: "Show rights acknowledgements, complaint procedure evidence, grievance follow-up, and ombudsman/contact information availability.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Resident rights / grievance lead",
    evidenceSource: "resident",
    evidenceLabel: "Resident documents, incidents/complaints, confidential intakes, and policy attestations",
    route: "/app/incidents",
    binderLocation: "Rights, Complaints & Incidents",
  },
  {
    id: "medication-administration",
    citation: "55 Pa. Code 2600.181 and Chapter 2800 medication administration",
    requirement: "Maintain medication self-administration determinations, medication-assistance qualifications, error/adverse-reaction follow-up, and retraining evidence.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Medication lead",
    evidenceSource: "incident",
    evidenceLabel: "Medication incidents, corrective actions, med-admin roster, practicums, and competency records",
    route: "/app/med-admin-roster",
    binderLocation: "Medication Compliance / Medication Safety",
  },
  {
    id: "incident-reporting",
    citation: "55 Pa. Code 2600/2800 — reportable incidents",
    requirement: "Track reportable incidents, notifications, investigations, final reports, and corrective actions through closure.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Administrator / incident owner",
    evidenceSource: "incident",
    evidenceLabel: "Incidents, confidential intakes, corrective actions, and notification records",
    route: "/app/incidents",
    binderLocation: "Rights, Complaints & Incidents / Incident Log",
  },
  {
    id: "physical-site-emergency",
    citation: "55 Pa. Code 2600/2800 — fire safety and emergency preparedness",
    requirement: "Keep physical-site inspections, emergency plan reviews, fire drill evidence, equipment checks, and failed-item corrections current.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Safety officer / administrator",
    evidenceSource: "physical_site",
    evidenceLabel: "Inspection items, fire/emergency drills, physical plant checks, violations, and corrective actions",
    route: "/app/inspections",
    binderLocation: "Environment & Emergency Preparedness",
  },
  {
    id: "policy-attestations",
    citation: "55 Pa. Code 2600/2800 — policies, procedures, notices",
    requirement: "Keep required policies, notices, rights/complaint procedures, and staff attestations published and current.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Policy owner",
    evidenceSource: "policy",
    evidenceLabel: "Policy documents, current versions, campaigns, attestations, and citation-aware templates",
    route: "/app/policy-documents",
    binderLocation: "Policies & Procedures",
  },
  {
    id: "binder-evidence-room",
    citation: "55 Pa. Code 2600/2800 — survey evidence production",
    requirement: "Maintain a current compliance binder and controlled evidence-room package for surveyor/regulator review.",
    facilityTypes: ["PCH", "ALR"],
    responsibleRole: "Binder owner / compliance lead",
    evidenceSource: "binder",
    evidenceLabel: "Compliance binder exports, evidence-room collections, report snapshots, and guest access audit trail",
    route: "/app/evidence",
    binderLocation: "Compliance Binder / Evidence Room",
  },
];

function isOverdue(date: string | null | undefined, today: string) {
  return Boolean(date && date < today);
}

function recordDate(record: { due_date?: string | null; expiration_date?: string | null; expires_at?: string | null }): string | null {
  return record.due_date ?? record.expiration_date ?? record.expires_at ?? null;
}

function dueDates(records: Array<{ due_date?: string | null; expiration_date?: string | null; expires_at?: string | null }>): string[] {
  return records.map(recordDate).filter((date): date is string => Boolean(date)).sort();
}

function statusIs(status: string | null | undefined, values: string[]) {
  return Boolean(status && values.includes(status));
}

function evaluateEvidence(obligation: RegulatoryObligation, input: CrosswalkEvidenceInput): Pick<RegulatoryCrosswalkRow, "status" | "nextDueDate" | "evidenceCount" | "gapCount"> {
  const today = input.today;
  if (obligation.evidenceSource === "training") {
    const records = [...(input.trainingRecords ?? []), ...(input.credentials ?? [])];
    const gaps = records.filter((record) => statusIs(record.status, ["expired", "missing", "overdue", "due_soon"]) || isOverdue(recordDate(record), today));
    return summarize(records.length, gaps.length, dueDates(records), today);
  }
  if (obligation.evidenceSource === "resident") {
    const records = input.residentItems ?? [];
    const gaps = records.filter((record) => statusIs(record.status, ["missing", "overdue", "due_soon"]) || isOverdue(record.due_date, today));
    return summarize(records.length, gaps.length, dueDates(records), today);
  }
  if (obligation.evidenceSource === "incident") {
    const incidents = input.incidents ?? [];
    const actions = input.correctiveActions ?? [];
    const incidentGaps = incidents.filter((incident) => !statusIs(incident.status, ["closed", "resolved"]) || !incident.final_report_submitted_at);
    const actionGaps = actions.filter((action) => !statusIs(action.status, ["completed", "closed"]) && isOverdue(action.due_date, today));
    return summarize(incidents.length + actions.length, incidentGaps.length + actionGaps.length, dueDates(actions), today);
  }
  if (obligation.evidenceSource === "physical_site") {
    const records: Array<{ status?: string | null; due_date?: string | null }> = [
      ...(input.inspectionItems ?? []),
      ...(input.violations ?? []).map((violation) => ({ status: violation.status })),
      ...(input.correctiveActions ?? []),
    ];
    const gaps = records.filter((record) => statusIs(record.status, ["missing", "expired", "due_soon", "open", "draft", "in_progress"]) || isOverdue(recordDate(record), today));
    return summarize(records.length, gaps.length, dueDates(records), today);
  }
  if (obligation.evidenceSource === "policy") {
    const policies = input.policyDocuments ?? [];
    const attestations = input.policyAttestations ?? [];
    const gaps = [...policies.filter((policy) => !policy.current_version_id), ...attestations.filter((attestation) => statusIs(attestation.status, ["pending", "overdue"]) || isOverdue(attestation.due_date, today))];
    return summarize(policies.length + attestations.length, gaps.length, dueDates(attestations), today);
  }
  const collections = input.evidenceCollections ?? [];
  const gaps = collections.filter((collection) => statusIs(collection.status, ["draft", "expired", "revoked"]) || isOverdue(collection.expires_at, today));
  return summarize(collections.length, gaps.length, dueDates(collections), today);
}

function summarize(evidenceCount: number, gapCount: number, sortedDates: string[], today: string): Pick<RegulatoryCrosswalkRow, "status" | "nextDueDate" | "evidenceCount" | "gapCount"> {
  const nextDueDate = sortedDates.find((date) => date >= today) ?? sortedDates[0] ?? null;
  let status: CrosswalkStatus = "inspection_ready";
  if (evidenceCount === 0) status = "missing_evidence";
  else if (gapCount > 0 && sortedDates.some((date) => date < today)) status = "overdue";
  else if (gapCount > 0) status = "needs_attention";
  return { status, nextDueDate, evidenceCount, gapCount };
}

export function canManageRegulatoryCrosswalk(role: Role | undefined): boolean {
  return role === "org_admin" || role === "facility_manager" || role === "platform_admin";
}

export function buildRegulatoryCrosswalkRows(input: CrosswalkEvidenceInput, role?: Role, governedRules: ActiveRegulatoryRule[] = []): RegulatoryCrosswalkRow[] {
  return REGULATORY_OBLIGATIONS.map((obligation) => {
    const governedRule = governedRules.find((rule) => rule.applicability.crosswalkObligationId === obligation.id) ?? null;
    const parameters = governedRule?.calculation_parameters ?? {};
    const governedObligation: RegulatoryObligation = governedRule ? {
      ...obligation,
      citation: governedRule.citation,
      requirement: typeof parameters.requirement === "string" ? parameters.requirement : obligation.requirement,
      responsibleRole: typeof parameters.responsibleRole === "string" ? parameters.responsibleRole : obligation.responsibleRole,
      evidenceLabel: typeof parameters.evidenceLabel === "string" ? parameters.evidenceLabel : obligation.evidenceLabel,
      route: typeof parameters.route === "string" ? parameters.route : obligation.route,
      binderLocation: typeof parameters.binderLocation === "string" ? parameters.binderLocation : obligation.binderLocation,
    } : obligation;
    return {
      ...governedObligation,
      ...evaluateEvidence(governedObligation, input),
      canEdit: canManageRegulatoryCrosswalk(role),
      governedRule,
    };
  });
}

export function filterRegulatoryCrosswalkRows(rows: RegulatoryCrosswalkRow[], filter: CrosswalkFilter): RegulatoryCrosswalkRow[] {
  const citation = filter.citation?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.facilityType && filter.facilityType !== "all" && !row.facilityTypes.includes(filter.facilityType)) return false;
    if (filter.status && filter.status !== "all" && row.status !== filter.status) return false;
    if (filter.evidenceSource && filter.evidenceSource !== "all" && row.evidenceSource !== filter.evidenceSource) return false;
    if (citation && !row.citation.toLowerCase().includes(citation) && !row.requirement.toLowerCase().includes(citation)) return false;
    return true;
  });
}
