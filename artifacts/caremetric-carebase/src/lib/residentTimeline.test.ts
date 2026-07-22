import { describe, expect, it } from "vitest";
import {
  filterResidentTimeline,
  normalizeResidentTimeline,
  residentTimelineSourceSummary,
  timelineTypeLabel,
  type ResidentTimelineEventLike,
} from "./residentTimeline";

const events: ResidentTimelineEventLike[] = [
  { occurred_at: "2026-07-20T09:00:00Z", event_type: "service_task", title: "Bathing support completed", status: "completed", detail: "Morning ADL", href: "/app/services", source_id: "svc-1" },
  { occurred_at: "2026-07-22T09:00:00Z", event_type: "incident", title: "Fall reported", status: "open", detail: "Unwitnessed fall", href: "/app/incidents/inc-1", source_id: "inc-1" },
  { occurred_at: "2026-07-21T09:00:00Z", event_type: "change_of_condition", title: "Condition change", status: "review", detail: "New bruising", href: "/app/change-of-condition/chg-1", source_id: "chg-1" },
  { occurred_at: "2026-07-22T09:00:00Z", event_type: "complaint", title: "Meal concern", status: "in_progress", detail: "Family called", href: "/app/complaints/cmp-1", source_id: "cmp-1" },
];

describe("resident timeline helpers", () => {
  it("normalizes events newest-first with deterministic same-time ordering", () => {
    expect(normalizeResidentTimeline(events).map((event) => `${event.event_type}:${event.source_id}`)).toEqual([
      "complaint:cmp-1",
      "incident:inc-1",
      "change_of_condition:chg-1",
      "service_task:svc-1",
    ]);
  });

  it("summarizes event source coverage", () => {
    const summary = residentTimelineSourceSummary([...events, { ...events[0], source_id: "svc-2" }]);

    expect(summary[0]).toEqual({ eventType: "service_task", label: "Service Task", count: 2 });
    expect(summary.map((item) => item.label)).toContain("Change Of Condition");
  });

  it("filters by event type and searches title, detail, status, event type, and href", () => {
    expect(filterResidentTimeline(events, { eventType: "incident", query: "" }).map((event) => event.title)).toEqual(["Fall reported"]);
    expect(filterResidentTimeline(events, { eventType: "all", query: "family" }).map((event) => event.title)).toEqual(["Meal concern"]);
    expect(filterResidentTimeline(events, { eventType: "all", query: "change-of-condition" }).map((event) => event.title)).toEqual(["Condition change"]);
    expect(filterResidentTimeline(events, { eventType: "service_task", query: "open" })).toEqual([]);
  });

  it("humanizes event type labels", () => {
    expect(timelineTypeLabel("change_of_condition")).toBe("Change Of Condition");
  });
});
