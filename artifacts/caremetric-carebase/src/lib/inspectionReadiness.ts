import { selectCurrentTrainingRecords, type CurrentTrainingRecordLike } from "./currentTrainingRecords";

export interface ReadinessActionTopic {
  id: string;
  title: string;
  citationRef: string | null;
  compliantCount: number;
  totalCount: number;
  frequencyWeight: number;
}

export interface ReadinessActionChecklistItem {
  id: string;
  category: string;
  prompt: string;
  level: "ready" | "attention" | "unknown";
  detail?: string;
}

export interface InspectionReadinessAction {
  id: string;
  kind: "citation_topic" | "entrance_item";
  title: string;
  detail: string;
  severity: "critical" | "high" | "medium";
  priorityScore: number;
}

function severityFor(score: number): InspectionReadinessAction["severity"] {
  if (score >= 250) return "critical";
  if (score >= 125) return "high";
  return "medium";
}

export function buildInspectionReadinessActions({
  topics,
  checklistItems,
  limit = 8,
}: {
  topics: ReadinessActionTopic[];
  checklistItems: ReadinessActionChecklistItem[];
  limit?: number;
}): InspectionReadinessAction[] {
  const topicActions = topics
    .filter((topic) => topic.totalCount > 0 && topic.compliantCount < topic.totalCount)
    .map<InspectionReadinessAction>((topic) => {
      const pct = Math.round((topic.compliantCount / topic.totalCount) * 100);
      const gap = 100 - pct;
      const priorityScore = gap * topic.frequencyWeight;
      return {
        id: `topic:${topic.id}`,
        kind: "citation_topic",
        title: topic.title,
        detail: `${topic.compliantCount}/${topic.totalCount} compliant${topic.citationRef ? ` • ${topic.citationRef}` : ""}`,
        severity: severityFor(priorityScore),
        priorityScore,
      };
    });

  const checklistActions = checklistItems
    .filter((item) => item.level !== "ready")
    .map<InspectionReadinessAction>((item) => {
      const priorityScore = item.level === "attention" ? 240 : 90;
      return {
        id: `entrance:${item.id}`,
        kind: "entrance_item",
        title: item.prompt,
        detail: item.detail ? `${item.category} • ${item.detail}` : item.category,
        severity: item.level === "attention" ? "high" : "medium",
        priorityScore,
      };
    });

  return [...topicActions, ...checklistActions]
    .sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Entrance-conference verdicts, shared by Inspection Readiness and Survey Day.
//
// These two pages ask the same questions of the same tables and must answer them identically -- a
// facility manager comparing "am I ready" the day before a survey with "am I ready" during one and
// getting two different answers has no way to tell which is the lie. They had already drifted twice,
// in both directions:
//
//   * TRAINING. Renewals insert a fresh employee_training_records row and leave the prior one
//     "expired" forever, so counting raw rows says a renewed CPR certification is outstanding.
//     Inspection Readiness reduced through selectCurrentTrainingRecords; Survey Day counted every
//     row, and reported Outstanding on training that had been renewed.
//   * INSPECTIONS. An empty scoped set is not readiness -- a facility with no fire-drill program at
//     all has zero outstanding fire-drill items, which is the one state a surveyor is guaranteed to
//     cite. Inspection Readiness graded that "attention -- nothing on file to check"; Survey Day
//     graded it Ready.
//
// Living here is what stops a third drift: neither page owns a private copy of the rule.
// ---------------------------------------------------------------------------------------------

export type ReadinessLevel = "ready" | "attention" | "unknown";

export interface ReadinessVerdict {
  level: ReadinessLevel;
  detail?: string;
}

/** The three statuses that mean a dated compliance obligation is not currently satisfied. */
export const OUTSTANDING_READINESS_STATUSES = ["expired", "due_soon", "missing"] as const;

export function isOutstandingReadinessStatus(status: string | null | undefined): boolean {
  return (OUTSTANDING_READINESS_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * Training readiness over raw employee_training_records rows: superseded history is dropped first,
 * so only the current record per (employee, training type) can put the facility in Attention.
 */
export function trainingReadinessVerdict<T extends CurrentTrainingRecordLike & { status: string }>(
  records: T[],
): ReadinessVerdict {
  const outstanding = selectCurrentTrainingRecords(records).filter((record) => isOutstandingReadinessStatus(record.status));
  return outstanding.length === 0
    ? { level: "ready" }
    : { level: "attention", detail: `${outstanding.length} outstanding` };
}

/**
 * The inspection items one checklist prompt is asking about. entrance_conference_items.item_types
 * names them; without the scope every 'inspections' row showed the same whole-table verdict, so one
 * overdue generator flipped the fire-drill and emergency-plan prompts too. An empty or absent scope
 * means the prompt covers everything.
 */
export function scopedInspectionItems<T extends { item_type: string }>(
  items: T[],
  itemTypes: string[] | null | undefined,
): T[] {
  if (!itemTypes || itemTypes.length === 0) return items;
  return items.filter((item) => itemTypes.includes(item.item_type));
}

export function inspectionReadinessVerdict<T extends { item_type: string; status: string }>(
  items: T[],
  itemTypes: string[] | null | undefined,
): ReadinessVerdict {
  const scoped = scopedInspectionItems(items, itemTypes);
  // Nothing on file is not readiness.
  if (scoped.length === 0) return { level: "attention", detail: "nothing on file to check" };
  const outstanding = scoped.filter((item) => isOutstandingReadinessStatus(item.status));
  return outstanding.length === 0
    ? { level: "ready", detail: `${scoped.length} on schedule` }
    : { level: "attention", detail: `${outstanding.length} outstanding` };
}
