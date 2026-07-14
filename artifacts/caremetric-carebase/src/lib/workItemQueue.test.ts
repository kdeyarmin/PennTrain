import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database.types";
import {
  isWorkItemOverdue,
  sortWorkItems,
  sourceRouteForWorkItem,
  workQueuePathForRole,
} from "./workItemQueue";

type WorkItem = Tables<"work_items">;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: crypto.randomUUID(),
    organization_id: crypto.randomUUID(),
    facility_id: crypto.randomUUID(),
    template_id: null,
    source_type: "incident",
    source_id: crypto.randomUUID(),
    deduplication_key: crypto.randomUUID(),
    title: "Follow up",
    description: null,
    owner_profile_id: null,
    priority: "normal",
    due_at: "2026-07-14T12:00:00.000Z",
    state: "open",
    closure_reason: null,
    approved_by: null,
    approved_at: null,
    escalated_at: null,
    recurrence_key: null,
    recurrence_number: 1,
    root_cause: null,
    effectiveness_review_due_at: null,
    effectiveness_result: null,
    created_by: null,
    created_at: "2026-07-13T12:00:00.000Z",
    updated_at: "2026-07-13T12:00:00.000Z",
    closed_at: null,
    ...overrides,
  };
}

describe("work item queue", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("treats only active past-due work as overdue", () => {
    expect(isWorkItemOverdue(item({ due_at: "2026-07-12T12:00:00.000Z" }), now)).toBe(true);
    expect(isWorkItemOverdue(item({ due_at: "2026-07-12T12:00:00.000Z", state: "closed" }), now)).toBe(false);
    expect(isWorkItemOverdue(item({ due_at: "2026-07-14T12:00:00.000Z" }), now)).toBe(false);
  });

  it("sorts overdue work first, then priority and due date", () => {
    const normal = item({ id: "normal", priority: "normal", due_at: "2026-07-15T12:00:00.000Z" });
    const urgent = item({ id: "urgent", priority: "urgent", due_at: "2026-07-16T12:00:00.000Z" });
    const overdue = item({ id: "overdue", priority: "low", due_at: "2026-07-12T12:00:00.000Z" });
    expect(sortWorkItems([normal, urgent, overdue], now).map((work) => work.id))
      .toEqual(["overdue", "urgent", "normal"]);
  });

  it("routes source records and keeps employee work under self service", () => {
    expect(sourceRouteForWorkItem(item({ source_type: "violation", source_id: "v1" })))
      .toBe("/app/violations/v1");
    expect(sourceRouteForWorkItem(item({
      source_type: "incident",
      source_id: "i1",
      deduplication_key: "confidential-intake:i1",
    }))).toBe("/app/confidential-incidents/i1");
    expect(sourceRouteForWorkItem(item({ source_type: "resident_calendar", source_id: "follow-up-1" })))
      .toBe("/app/resident-services-calendar");
    expect(workQueuePathForRole("employee", "w1")).toBe("/me/work/w1");
    expect(workQueuePathForRole("org_admin")).toBe("/app/work");
  });
});
