export interface ResidentTimelineEventLike {
  occurred_at: string;
  event_type: string;
  title: string;
  status: string | null;
  detail: string | null;
  href: string;
  source_id: string;
}

export interface ResidentTimelineSourceSummary {
  eventType: string;
  label: string;
  count: number;
}

export interface ResidentTimelineFilterState {
  eventType: string;
  query: string;
}

export function timelineTypeLabel(eventType: string): string {
  return eventType.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function normalizeResidentTimeline(events: ResidentTimelineEventLike[]): ResidentTimelineEventLike[] {
  return [...events].sort((a, b) => {
    const dateDiff = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    if (dateDiff !== 0) return dateDiff;
    return `${a.event_type}:${a.source_id}`.localeCompare(`${b.event_type}:${b.source_id}`);
  });
}

export function residentTimelineSourceSummary(events: ResidentTimelineEventLike[]): ResidentTimelineSourceSummary[] {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.event_type, (counts.get(event.event_type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([eventType, count]) => ({ eventType, label: timelineTypeLabel(eventType), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function filterResidentTimeline(events: ResidentTimelineEventLike[], filters: ResidentTimelineFilterState): ResidentTimelineEventLike[] {
  const eventType = filters.eventType.trim();
  const query = filters.query.trim().toLowerCase();

  return normalizeResidentTimeline(events).filter((event) => {
    if (eventType && eventType !== "all" && event.event_type !== eventType) return false;
    if (!query) return true;
    return [event.title, event.detail, event.status, event.event_type, event.href]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(query));
  });
}
