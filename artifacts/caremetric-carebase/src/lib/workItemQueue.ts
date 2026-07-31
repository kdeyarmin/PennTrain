import type { Tables } from "@/lib/database.types";

export type WorkItem = Tables<"work_items">;

export const WORK_ITEM_STATES = [
  "open",
  "in_progress",
  "blocked",
  "pending_approval",
  "closed",
  "canceled",
] as const;

export const WORK_ITEM_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export const WORK_ITEM_STATE_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  pending_approval: "Pending approval",
  closed: "Closed",
  canceled: "Canceled",
};

export const WORK_ITEM_PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * The database taxonomy is the source of truth for which values may be written. This map is the
 * presentation companion for the detail page, notification copy, and any client-only fallback.
 * Unknown values remain readable instead of rendering a blank label.
 */
export const WORK_ITEM_SOURCE_LABELS: Record<string, string> = {
  assessment: "Assessment due",
  support_plan: "Support plan",
  service_delivery: "Service exception",
  resident_appointment: "Appointment follow-up",
  resident_calendar: "Resident calendar",
  hospital_return: "Hospital return",
  change_of_condition: "Change of condition",
  resident_agreement: "Resident agreement",
  admission_document: "Admission document",
  move_in: "Move-in readiness",
  resident_finance: "Resident finance",
  regulatory_requirement: "Regulatory requirement",
  violation: "Violation remediation",
  inspection: "Inspection finding",
  inspection_war_room: "Inspection response request",
  finding: "Audit finding",
  policy: "Policy review",
  corrective_action: "Corrective action",
  credential: "Credential",
  training_gap: "Training gap",
  exclusion_match: "Exclusion match",
  staffing: "Staffing",
  shift_handoff: "Shift handoff",
  facility_license: "Facility license",
  maintenance: "Maintenance",
  emergency_drill: "Emergency drill",
  incident: "Incident",
  near_miss: "Near miss",
  complaint: "Complaint",
  qapi: "QAPI",
  medication_integration: "Medication integration",
  automation: "Automation follow-up",
  copilot_draft: "Assistant draft",
  rule_exception: "Other rule exception",
};

const PRIORITY_ORDER: ReadonlyMap<string, number> =
  new Map(WORK_ITEM_PRIORITIES.map((priority, index) => [priority, index]));

export function isWorkItemOpen(item: WorkItem): boolean {
  return item.state !== "closed" && item.state !== "canceled";
}

export function isWorkItemOverdue(item: WorkItem, now = new Date()): boolean {
  return isWorkItemOpen(item) && new Date(item.due_at).getTime() < now.getTime();
}

export function sortWorkItems<T extends WorkItem>(items: T[], now = new Date()): T[] {
  return [...items].sort((a, b) => {
    const overdueDifference = Number(isWorkItemOverdue(b, now)) - Number(isWorkItemOverdue(a, now));
    if (overdueDifference !== 0) return overdueDifference;
    const priorityDifference =
      (PRIORITY_ORDER.get(a.priority) ?? WORK_ITEM_PRIORITIES.length)
      - (PRIORITY_ORDER.get(b.priority) ?? WORK_ITEM_PRIORITIES.length);
    if (priorityDifference !== 0) return priorityDifference;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });
}

function legacyRuleExceptionRoute(item: WorkItem): string | null {
  const key = item.deduplication_key;
  if (key.startsWith("support-plan-proposal:")) return "/app/state-forms";
  if (key.startsWith("service-exception:")) return "/app/services";
  if (key.startsWith("appointment-follow-up:")) return "/app/resident-services-calendar";
  if (key.startsWith("hospital-return-follow-up:")) return "/app/change-of-condition";
  if (key.startsWith("facility-license:")) return "/app/facilities";
  if (key.startsWith("call-off:")) return "/app/schedule";
  if (key.startsWith("shift-log:")) return "/app/shift-handoffs";
  if (key.startsWith("inspection-war-room:")) return "/app/value-center";
  return null;
}

/**
 * Deduplication-key prefixes that mark an `incident`-typed work item as a confidential intake.
 * Confidential work is deliberately spread across more than one prefix -- the intake itself and a
 * manager escalation must be separate work items, so they cannot share a key -- and every prefix
 * has to route to the confidential detail page, not the ordinary incident page.
 */
export const CONFIDENTIAL_INTAKE_DEDUPE_PREFIXES = [
  "confidential-intake:",
  "confidential-escalation:",
] as const;

/**
 * Returns the closest safe operational destination for every registered work-item source type.
 * Some source tables have a dedicated detail route; others intentionally land on the filtered
 * operating workspace because their source record is not itself a routable page. Returning a broad,
 * correct workspace is better than hiding the action entirely or constructing an invalid URL from a
 * source id whose table shape differs by creator.
 */
export function sourceRouteForWorkItem(item: WorkItem): string | null {
  switch (item.source_type) {
    case "assessment":
    case "support_plan":
      return "/app/state-forms";
    case "service_delivery":
      return "/app/services";
    case "resident_appointment":
    case "resident_calendar":
      return "/app/resident-services-calendar";
    case "hospital_return":
      return "/app/change-of-condition";
    case "change_of_condition":
      return `/app/change-of-condition/${item.source_id}`;
    case "resident_agreement":
    case "admission_document":
      return "/app/admissions";
    case "move_in":
      // Historical creators use the resident as the source; keep the route valid for both old and
      // new rows instead of guessing that every source id is a move-in workspace id.
      return `/app/residents/${item.source_id}`;
    case "resident_finance":
      return "/app/resident-finance";
    case "regulatory_requirement":
      return "/app/compliance-command-center";
    case "violation":
      return `/app/violations/${item.source_id}`;
    case "inspection":
      return `/app/inspections/${item.source_id}`;
    case "inspection_war_room":
      return "/app/value-center";
    case "finding":
      return "/app/inspection-readiness";
    case "policy":
      return "/app/policy-documents";
    case "corrective_action":
      return "/app/violations";
    case "credential":
      return "/app/credentials";
    case "training_gap":
      return "/app/training-matrix";
    case "exclusion_match":
      return "/app/exclusion-screening";
    case "staffing":
      return "/app/schedule";
    case "shift_handoff":
      return "/app/shift-handoffs";
    case "facility_license":
      return "/app/facilities";
    case "maintenance":
      return `/app/maintenance/${item.source_id}`;
    case "emergency_drill":
      return "/app/emergency";
    case "incident":
    case "near_miss":
      // Confidential intakes are stored as source_type 'incident' with the intake id, so the
      // deduplication key is the only thing distinguishing them. Escalations get their own key
      // prefix rather than reusing 'confidential-intake:', which would collide with the intake's
      // own work item and silently suppress the escalation row -- so both prefixes route here.
      return CONFIDENTIAL_INTAKE_DEDUPE_PREFIXES.some((prefix) => item.deduplication_key.startsWith(prefix))
        ? `/app/confidential-incidents/${item.source_id}`
        : `/app/incidents/${item.source_id}`;
    case "complaint":
      return `/app/complaints/${item.source_id}`;
    case "qapi":
      return `/app/qapi/projects/${item.source_id}`;
    case "medication_integration":
      return "/app/medication-integration";
    case "automation":
      return "/app/value-center";
    case "copilot_draft":
      return "/app/regulatory-copilot";
    case "rule_exception":
      return legacyRuleExceptionRoute(item);
    default:
      return null;
  }
}

export function workItemSourceLabel(sourceType: string): string {
  return WORK_ITEM_SOURCE_LABELS[sourceType]
    ?? sourceType.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export function workQueuePathForRole(role: string | undefined, itemId?: string): string {
  const base = role === "employee" ? "/me/work" : "/app/work";
  return itemId ? `${base}/${itemId}` : base;
}

export interface WorkQueuePresentation {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  showScopeSwitcher: boolean;
  showFacilityFilter: boolean;
  showOwnerFilter: boolean;
  showFacilityColumn: boolean;
  showSourceColumn: boolean;
  showOwnerColumn: boolean;
}

export function workQueuePresentationForRole(role: string | undefined): WorkQueuePresentation {
  const isEmployee = role === "employee";
  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(role ?? "");

  if (isEmployee) {
    return {
      title: "My Work",
      description: "Compliance and administrative work assigned to you.",
      emptyTitle: "No assigned work matches these filters",
      emptyDescription: "Try a different status, priority, source, or due-date filter. New assigned work will appear here automatically.",
      showScopeSwitcher: false,
      showFacilityFilter: false,
      showOwnerFilter: false,
      showFacilityColumn: false,
      showSourceColumn: false,
      showOwnerColumn: false,
    };
  }

  return {
    title: "Operational Work Queue",
    description: "Owned remediation across facilities, sources, approvals, and deadlines.",
    emptyTitle: "No work matches these filters",
    emptyDescription: "Change the scope or filters to review other work.",
    showScopeSwitcher: true,
    showFacilityFilter: true,
    showOwnerFilter: canManage,
    showFacilityColumn: true,
    showSourceColumn: true,
    showOwnerColumn: true,
  };
}
