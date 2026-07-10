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
