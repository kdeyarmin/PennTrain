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

export function sourceRouteForWorkItem(item: WorkItem): string | null {
  switch (item.source_type) {
    case "incident":
    case "near_miss":
      return item.deduplication_key.startsWith("confidential-intake:")
        ? `/app/confidential-incidents/${item.source_id}`
        : `/app/incidents/${item.source_id}`;
    case "violation":
      return `/app/violations/${item.source_id}`;
    case "inspection":
      return `/app/inspections/${item.source_id}`;
    case "credential":
      return "/app/credentials";
    case "move_in":
      return `/app/residents/${item.source_id}`;
    case "training_gap":
      return "/app/training-matrix";
    case "exclusion_match":
      return "/app/exclusion-screening";
    case "policy":
      return "/app/policy-documents";
    case "qapi":
      return `/app/qapi/projects/${item.source_id}`;
    case "resident_calendar":
      return "/app/resident-services-calendar";
    case "resident_finance":
      return "/app/resident-finance";
    default:
      return null;
  }
}

export function workQueuePathForRole(role: string | undefined, itemId?: string): string {
  const base = role === "employee" ? "/me/work" : "/app/work";
  return itemId ? `${base}/${itemId}` : base;
}
