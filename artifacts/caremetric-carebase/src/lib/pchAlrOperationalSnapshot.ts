export type OperationsSeverity = "good" | "watch" | "attention";

export interface SnapshotTrainingRecord { status?: string | null; due_date?: string | null }
export interface SnapshotResidentComplianceItem { status?: string | null; due_date?: string | null; item_type?: string | null }
export interface SnapshotIncident { status?: string | null; final_report_submitted_at?: string | null; incident_type?: string | null }
export interface SnapshotCorrectiveAction { status?: string | null; due_date?: string | null }
export interface SnapshotPolicyAttestation { status?: string | null; due_date?: string | null }
export interface SnapshotCredential { status?: string | null; credential_type?: string | null }

export interface PchAlrSnapshotInput {
  today: string;
  trainingRecords?: SnapshotTrainingRecord[];
  residentItems?: SnapshotResidentComplianceItem[];
  incidents?: SnapshotIncident[];
  correctiveActions?: SnapshotCorrectiveAction[];
  policyAttestations?: SnapshotPolicyAttestation[];
  credentials?: SnapshotCredential[];
}

export interface PchAlrOperationsQueueItem {
  id: string;
  label: string;
  count: number;
  severity: OperationsSeverity;
  route: string;
  guidance: string;
}

export interface CommandCenterSignals {
  workforceGaps: number;
  residentReadinessGaps: number;
  medicationFollowUps: number;
  incidentComplaintOpen: number;
  overdueCorrectiveActions: number;
  overduePolicyAttestations: number;
  activeEmergencyEvents: number;
  emergencyUnaccounted: number;
  openWorkOrders: number;
  highRiskWorkOrders: number;
}

export interface CommandCenterWorkQueue {
  openCount: number;
  urgentCount: number;
  overdueCount: number;
  unassignedCount: number;
  pendingApprovalCount: number;
}

function isOverdue(dueDate: string | null | undefined, today: string): boolean {
  return Boolean(dueDate && dueDate < today);
}

function statusIn(status: string | null | undefined, values: string[]): boolean {
  return Boolean(status && values.includes(status));
}

// Two outcomes, stated as two outcomes.
//
// This took a `watchThreshold = 1` and returned `count >= watchThreshold ? "attention" : "watch"`.
// Every one of the sixteen call sites uses the default, and `count <= 0` has already returned by
// then -- so the condition was `count >= 1` against a count that is always >= 1, and "watch" could
// not be produced from anywhere in the codebase. The parameter read like a tunable dial that did
// nothing, which is worse than no dial: `summarizePchAlrQueue`'s "Attention buckets" metric was in
// fact just "buckets with anything open", and nobody reading `severityFor` would have known that.
//
// Deliberately NOT given a real threshold instead. Picking one (1-2 is watch, 3+ is attention, or
// whatever) would change what that dashboard metric counts, and that is a product decision about
// how a Pennsylvania facility should triage its own queues -- not something to invent inside a
// cleanup. "watch" stays in OperationsSeverity for whoever makes that decision; what changes here
// is only that the code no longer claims to produce it.
function severityFor(count: number): OperationsSeverity {
  return count > 0 ? "attention" : "good";
}

export function buildPchAlrOperationsQueue(input: PchAlrSnapshotInput): PchAlrOperationsQueueItem[] {
  const today = input.today;
  const trainingGaps = (input.trainingRecords ?? []).filter((record) =>
    statusIn(record.status, ["expired", "missing", "overdue"]) || isOverdue(record.due_date, today),
  ).length;
  const residentStateFormGaps = (input.residentItems ?? []).filter((item) =>
    statusIn(item.status, ["missing", "overdue", "due_soon"]) || isOverdue(item.due_date, today),
  ).length;
  const unresolvedIncidents = (input.incidents ?? []).filter((incident) =>
    !statusIn(incident.status, ["closed", "resolved"]) || !incident.final_report_submitted_at,
  ).length;
  const overdueActions = (input.correctiveActions ?? []).filter((action) =>
    !statusIn(action.status, ["completed", "cancelled"]) && isOverdue(action.due_date, today),
  ).length;
  const medicationFollowUps = (input.incidents ?? []).filter((incident) =>
    (incident.incident_type ?? "").toLowerCase().includes("med") && (!statusIn(incident.status, ["closed", "resolved"]) || !incident.final_report_submitted_at),
  ).length;
  const policyAttestationGaps = (input.policyAttestations ?? []).filter((attestation) =>
    statusIn(attestation.status, ["pending", "overdue"]) && isOverdue(attestation.due_date, today),
  ).length;
  const credentialGaps = (input.credentials ?? []).filter((credential) =>
    statusIn(credential.status, ["expired", "missing", "due_soon"]),
  ).length;

  return [
    {
      id: "daily-training",
      label: "Training and credential gaps",
      count: trainingGaps + credentialGaps,
      severity: severityFor(trainingGaps + credentialGaps),
      route: "/app/training-matrix",
      guidance: "Assign or validate overdue training, missing credentials, and expiring clearances before survey sampling.",
    },
    {
      id: "move-in-readiness",
      label: "Resident/state-form readiness gaps",
      count: residentStateFormGaps,
      severity: severityFor(residentStateFormGaps),
      route: "/app/state-forms",
      guidance: "Attach state-approved form documentation for admission, annual, significant-change, and Department-requested items.",
    },
    {
      id: "medication-safety",
      label: "Medication follow-ups open",
      count: medicationFollowUps,
      severity: severityFor(medicationFollowUps),
      route: "/app/med-admin-roster",
      guidance: "Close medication event follow-up, check patterns by staff/shift/resident, and trigger retraining when needed.",
    },
    {
      id: "incidents-rights",
      label: "Incident, complaint, and grievance items open",
      count: unresolvedIncidents,
      severity: severityFor(unresolvedIncidents),
      route: "/app/incidents",
      guidance: "Verify notifications, resident/designated-person follow-up, investigation status, and final report documentation.",
    },
    {
      id: "corrective-actions",
      label: "Overdue corrective actions",
      count: overdueActions,
      severity: severityFor(overdueActions),
      route: "/app/violations",
      guidance: "Update owners, due dates, proof of completion, and POC documentation before the next huddle.",
    },
    {
      id: "policy-attestations",
      label: "Policy attestations overdue",
      count: policyAttestationGaps,
      severity: severityFor(policyAttestationGaps),
      route: "/app/policy-documents",
      guidance: "Remind required audiences and file attestation documentation behind the citation-aware policy/template section.",
    },
  ];
}

export function buildPchAlrOperationsQueueFromSnapshot(
  signals: CommandCenterSignals,
  workQueue: CommandCenterWorkQueue,
): PchAlrOperationsQueueItem[] {
  return [
    {
      id: "daily-training",
      label: "Training and credential gaps",
      count: signals.workforceGaps,
      severity: severityFor(signals.workforceGaps),
      route: "/app/training-matrix",
      guidance: "Assign or validate overdue training, missing credentials, and expiring clearances before survey sampling.",
    },
    {
      id: "move-in-readiness",
      label: "Resident/state-form readiness gaps",
      count: signals.residentReadinessGaps,
      severity: severityFor(signals.residentReadinessGaps),
      route: "/app/state-forms",
      guidance: "Attach state-approved form documentation for admission, annual, significant-change, and Department-requested items.",
    },
    {
      id: "medication-safety",
      label: "Medication follow-ups open",
      count: signals.medicationFollowUps,
      severity: severityFor(signals.medicationFollowUps),
      route: "/app/med-admin-roster",
      guidance: "Close medication event follow-up, check patterns by staff, shift, and resident, and trigger retraining when needed.",
    },
    {
      id: "incidents-rights",
      label: "Incident, complaint, and grievance items open",
      count: signals.incidentComplaintOpen,
      severity: severityFor(signals.incidentComplaintOpen),
      route: "/app/complaints",
      guidance: "Verify notifications, investigation status, non-retaliation safeguards, response deadlines, and closure documentation.",
    },
    {
      id: "corrective-actions",
      label: "Overdue corrective actions",
      count: signals.overdueCorrectiveActions,
      severity: severityFor(signals.overdueCorrectiveActions),
      route: "/app/work",
      guidance: "Update owners, due dates, proof of completion, approvals, and effectiveness review documentation.",
    },
    {
      id: "policy-attestations",
      label: "Policy attestations overdue",
      count: signals.overduePolicyAttestations,
      severity: severityFor(signals.overduePolicyAttestations),
      route: "/app/policy-documents",
      guidance: "Remind required audiences and file attestation documentation behind the citation-aware policy section.",
    },
    {
      id: "emergency-operations",
      label: "Emergency command items active",
      count: signals.activeEmergencyEvents + signals.emergencyUnaccounted,
      severity: severityFor(signals.activeEmergencyEvents + signals.emergencyUnaccounted),
      route: "/app/emergency-operations",
      guidance: "Resolve resident and staff accountability first, then communications, relocation, after-action, and open corrective work.",
    },
    {
      id: "maintenance-operations",
      label: "Maintenance and safety work orders open",
      count: signals.openWorkOrders,
      severity: signals.highRiskWorkOrders > 0 ? "attention" : severityFor(signals.openWorkOrders),
      route: "/app/maintenance",
      guidance: "Prioritize immediate-danger and emergency work, document protective actions, and obtain supervisor verification.",
    },
    {
      id: "unified-work",
      label: "Owned operational work open",
      count: workQueue.openCount,
      severity: workQueue.urgentCount > 0 || workQueue.overdueCount > 0 ? "attention" : severityFor(workQueue.openCount),
      route: "/app/work",
      guidance: `${workQueue.urgentCount} urgent · ${workQueue.overdueCount} overdue · ${workQueue.unassignedCount} unassigned · ${workQueue.pendingApprovalCount} awaiting approval.`,
    },
  ];
}

export function summarizePchAlrQueue(queue: PchAlrOperationsQueueItem[]) {
  return {
    totalOpen: queue.reduce((sum, item) => sum + item.count, 0),
    attentionCount: queue.filter((item) => item.severity === "attention").length,
    readyCount: queue.filter((item) => item.count === 0).length,
  };
}
