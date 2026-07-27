/**
 * The work item source taxonomy (program plan Phase 7a, request item 17b).
 *
 * WHY THIS EXISTS. `work_items.source_type` was free text, and seven different kinds of work were all
 * filed as `rule_exception`: support-plan proposals, service exceptions, appointment follow-ups,
 * hospital-return follow-ups, facility licences, unfilled shifts, and shift handoffs. The queue RPC
 * has always accepted a source-type filter; it just had nothing meaningful to filter by.
 *
 * This module mirrors `public.work_item_source_types` so the client can group, label, and route
 * without a second round trip for what is effectively a static list. The server owns enforcement --
 * a trigger rejects a type outside the taxonomy -- and a test here asserts the two lists match, so
 * drift is caught rather than discovered.
 */

export type WorkItemCategory =
  | "resident_care"
  | "compliance"
  | "workforce"
  | "facility"
  | "quality";

export interface WorkItemSourceType {
  key: string;
  label: string;
  category: WorkItemCategory;
  description: string;
  sortOrder: number;
}

export const WORK_ITEM_CATEGORY_LABELS: Record<WorkItemCategory, string> = {
  resident_care: "Resident care",
  compliance: "Compliance",
  workforce: "Workforce",
  facility: "Facility",
  quality: "Quality and safety",
};

/**
 * Mirrors the seed across 20260726100100 (the taxonomy) and 20260726120100 (the completion that
 * made it a superset of the types already in use). A test parses both and asserts they match.
 */
export const WORK_ITEM_SOURCE_TYPES: WorkItemSourceType[] = [
  { key: "assessment", label: "Assessment due", category: "resident_care", sortOrder: 10, description: "A required resident assessment is due or overdue." },
  { key: "support_plan", label: "Support plan", category: "resident_care", sortOrder: 20, description: "A support plan needs writing, reviewing, or revising." },
  { key: "service_delivery", label: "Service exception", category: "resident_care", sortOrder: 30, description: "A scheduled service was refused, missed, or delivered differently than planned." },
  { key: "resident_appointment", label: "Appointment follow-up", category: "resident_care", sortOrder: 40, description: "An appointment outcome needs acting on." },
  { key: "hospital_return", label: "Hospital return", category: "resident_care", sortOrder: 50, description: "A resident returned from hospital and the reconciliation is outstanding." },
  { key: "change_of_condition", label: "Change of condition", category: "resident_care", sortOrder: 60, description: "A recorded change in a resident's condition needs review." },
  { key: "resident_agreement", label: "Resident agreement", category: "resident_care", sortOrder: 70, description: "A resident agreement is unsigned or needs renewal." },
  { key: "admission_document", label: "Admission document", category: "resident_care", sortOrder: 80, description: "An admission document is missing or unsigned." },
  { key: "move_in", label: "Move-in readiness", category: "resident_care", sortOrder: 90, description: "A move-in task is outstanding." },
  { key: "resident_finance", label: "Resident finance", category: "resident_care", sortOrder: 100, description: "A resident account needs attention." },
  { key: "resident_calendar", label: "Resident calendar", category: "resident_care", sortOrder: 45, description: "A resident appointment or calendar follow-up is outstanding." },
  { key: "resident_service_task_instance", label: "Scheduled service task", category: "resident_care", sortOrder: 35, description: "A scheduled resident service task needs attention." },
  { key: "support_plan_proposal", label: "Support plan proposal", category: "resident_care", sortOrder: 25, description: "A generated support plan proposal is waiting for review." },
  { key: "dietary_exception", label: "Dietary exception", category: "resident_care", sortOrder: 110, description: "A dietary order or meal service exception needs resolving." },

  { key: "regulatory_requirement", label: "Regulatory requirement", category: "compliance", sortOrder: 200, description: "A recurring regulatory obligation is due." },
  { key: "violation", label: "Violation remediation", category: "compliance", sortOrder: 210, description: "A cited violation needs remediation." },
  { key: "inspection", label: "Inspection finding", category: "compliance", sortOrder: 220, description: "An inspection finding needs correcting." },
  { key: "finding", label: "Audit finding", category: "compliance", sortOrder: 230, description: "An internal audit finding needs closing." },
  { key: "policy", label: "Policy review", category: "compliance", sortOrder: 240, description: "A policy is due for review or acknowledgement." },
  { key: "corrective_action", label: "Corrective action", category: "compliance", sortOrder: 250, description: "A corrective action is open or awaiting verification." },
  { key: "inspection_war_room", label: "Inspection request", category: "compliance", sortOrder: 225, description: "A documentation request during an inspection is awaiting verification." },

  { key: "credential", label: "Credential", category: "workforce", sortOrder: 300, description: "A staff credential is expiring or expired." },
  { key: "training_gap", label: "Training gap", category: "workforce", sortOrder: 310, description: "Required training is overdue." },
  { key: "exclusion_match", label: "Exclusion match", category: "workforce", sortOrder: 320, description: "A federal or state exclusion list check needs resolving." },
  { key: "staffing", label: "Staffing", category: "workforce", sortOrder: 330, description: "A shift is unfilled or a staffing rule was breached." },
  { key: "shift_handoff", label: "Shift handoff", category: "workforce", sortOrder: 340, description: "A handoff item needs picking up." },

  { key: "facility_license", label: "Facility licence", category: "facility", sortOrder: 400, description: "A facility licence or registration is expiring." },
  { key: "maintenance", label: "Maintenance", category: "facility", sortOrder: 410, description: "A maintenance inspection or hazard needs attention." },
  { key: "emergency_drill", label: "Emergency drill", category: "facility", sortOrder: 420, description: "A required drill is due or its after-action is outstanding." },
  { key: "food_safety", label: "Food safety", category: "facility", sortOrder: 405, description: "A food safety check or temperature excursion needs action." },
  { key: "emergency", label: "Emergency operations", category: "facility", sortOrder: 415, description: "An emergency event or drill needs follow-through." },

  { key: "incident", label: "Incident", category: "quality", sortOrder: 500, description: "An incident investigation or follow-up step is outstanding." },
  { key: "near_miss", label: "Near miss", category: "quality", sortOrder: 510, description: "A near miss needs reviewing." },
  { key: "complaint", label: "Complaint", category: "quality", sortOrder: 520, description: "A complaint has a response deadline." },
  { key: "qapi", label: "QAPI", category: "quality", sortOrder: 530, description: "A QAPI project action is due." },
  { key: "medication_integration", label: "Medication integration", category: "quality", sortOrder: 540, description: "A medication interface exception needs resolving." },
  { key: "automation", label: "Automation follow-up", category: "quality", sortOrder: 550, description: "An automation rule raised work for a person." },
  { key: "copilot_draft", label: "Assistant draft", category: "quality", sortOrder: 560, description: "A drafted action is waiting for a person to accept or discard." },

  { key: "rule_exception", label: "Other rule exception", category: "compliance", sortOrder: 900, description: "Work raised by a rule that has no more specific source type." },
];

const BY_KEY = new Map(WORK_ITEM_SOURCE_TYPES.map((entry) => [entry.key, entry]));

export function workItemSourceType(key: string): WorkItemSourceType | undefined {
  return BY_KEY.get(key);
}

/**
 * The label to show for a source type. An unrecognized key is humanized rather than hidden: a row
 * whose type this build does not know about must still be readable, because the alternative is a
 * blank chip on somebody's queue.
 */
export function workItemSourceLabel(key: string): string {
  return BY_KEY.get(key)?.label
    ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function workItemCategory(key: string): WorkItemCategory | null {
  return BY_KEY.get(key)?.category ?? null;
}

export interface WorkItemLike {
  id: string;
  source_type: string;
  source_id: string;
  state: string;
  priority: string;
  due_at: string;
  title: string;
}

/**
 * Where a work item's source record lives. Returns null when the source has no dedicated page --
 * better an item with no link than a link to a route that 404s.
 */
export function workItemSourceHref(item: Pick<WorkItemLike, "source_type" | "source_id">): string | null {
  switch (item.source_type) {
    case "incident":
    case "near_miss":
      return `/app/incidents/${item.source_id}`;
    case "qapi":
      return `/app/qapi`;
    case "complaint":
      return `/app/complaints`;
    case "regulatory_requirement":
      // The Compliance Command Center, not "/app/compliance" -- that route does not exist.
      return `/app/compliance-command-center`;
    default:
      return null;
  }
}

export interface SourceTypeCount {
  key: string;
  label: string;
  category: WorkItemCategory;
  count: number;
}

/** Counts by source type, in taxonomy order, with empty types dropped. */
export function countBySourceType(items: Pick<WorkItemLike, "source_type">[]): SourceTypeCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.source_type, (counts.get(item.source_type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: workItemSourceLabel(key),
      category: workItemCategory(key) ?? "compliance",
      count,
    }))
    .sort((a, b) => {
      const orderA = BY_KEY.get(a.key)?.sortOrder ?? 9_999;
      const orderB = BY_KEY.get(b.key)?.sortOrder ?? 9_999;
      return orderA - orderB || a.key.localeCompare(b.key);
    });
}

export interface CategoryGroup {
  category: WorkItemCategory;
  label: string;
  count: number;
  types: SourceTypeCount[];
}

/** The same counts rolled up to the handful of headings a person thinks in. */
export function groupByCategory(items: Pick<WorkItemLike, "source_type">[]): CategoryGroup[] {
  const bySource = countBySourceType(items);
  const order: WorkItemCategory[] = ["resident_care", "quality", "compliance", "workforce", "facility"];
  return order
    .map((category) => {
      const types = bySource.filter((entry) => entry.category === category);
      return {
        category,
        label: WORK_ITEM_CATEGORY_LABELS[category],
        count: types.reduce((sum, entry) => sum + entry.count, 0),
        types,
      };
    })
    .filter((group) => group.count > 0);
}
