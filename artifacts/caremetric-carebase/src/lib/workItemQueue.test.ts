import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database.types";
import {
  isWorkItemOverdue,
  sortWorkItems,
  sourceRouteForWorkItem,
  workItemSourceLabel,
  workQueuePathForRole,
  workQueuePresentationForRole,
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

  it("routes dedicated source records and keeps employee work under self service", () => {
    expect(sourceRouteForWorkItem(item({ source_type: "violation", source_id: "v1" })))
      .toBe("/app/violations/v1");
    expect(sourceRouteForWorkItem(item({
      source_type: "incident",
      source_id: "i1",
      deduplication_key: "confidential-intake:i1",
    }))).toBe("/app/confidential-incidents/i1");
    expect(sourceRouteForWorkItem(item({ source_type: "complaint", source_id: "c1" })))
      .toBe("/app/complaints/c1");
    expect(sourceRouteForWorkItem(item({ source_type: "maintenance", source_id: "m1" })))
      .toBe("/app/maintenance/m1");
    expect(workQueuePathForRole("employee", "w1")).toBe("/me/work/w1");
    expect(workQueuePathForRole("org_admin")).toBe("/app/work");
  });

  it("routes every registered operational source to a usable workspace", () => {
    const expected: Record<string, string> = {
      assessment: "/app/state-forms",
      support_plan: "/app/state-forms",
      service_delivery: "/app/services",
      resident_appointment: "/app/resident-services-calendar",
      resident_calendar: "/app/resident-services-calendar",
      hospital_return: "/app/change-of-condition",
      change_of_condition: "/app/change-of-condition/source-1",
      resident_agreement: "/app/admissions",
      admission_document: "/app/admissions",
      move_in: "/app/residents/source-1",
      resident_finance: "/app/resident-finance",
      regulatory_requirement: "/app/compliance-command-center",
      inspection: "/app/inspections/source-1",
      inspection_war_room: "/app/value-center",
      finding: "/app/inspection-readiness",
      policy: "/app/policy-documents",
      corrective_action: "/app/violations",
      credential: "/app/credentials",
      training_gap: "/app/training-matrix",
      exclusion_match: "/app/exclusion-screening",
      staffing: "/app/schedule",
      shift_handoff: "/app/shift-handoffs",
      facility_license: "/app/facilities",
      emergency_drill: "/app/emergency",
      qapi: "/app/qapi/projects/source-1",
      medication_integration: "/app/medication-integration",
      automation: "/app/value-center",
      copilot_draft: "/app/regulatory-copilot",
    };
    for (const [sourceType, route] of Object.entries(expected)) {
      expect(sourceRouteForWorkItem(item({ source_type: sourceType, source_id: "source-1" })), sourceType)
        .toBe(route);
    }
  });

  it("keeps legacy catch-all rows actionable from their stable deduplication prefixes", () => {
    const cases: Array<[string, string]> = [
      ["support-plan-proposal:1", "/app/state-forms"],
      ["service-exception:1", "/app/services"],
      ["appointment-follow-up:1", "/app/resident-services-calendar"],
      ["hospital-return-follow-up:1", "/app/change-of-condition"],
      ["facility-license:1", "/app/facilities"],
      ["call-off:1", "/app/schedule"],
      ["shift-log:1", "/app/shift-handoffs"],
      ["inspection-war-room:1", "/app/value-center"],
    ];
    for (const [deduplicationKey, route] of cases) {
      expect(sourceRouteForWorkItem(item({ source_type: "rule_exception", deduplication_key: deduplicationKey })))
        .toBe(route);
    }
  });

  it("uses governed source labels and a readable fallback", () => {
    expect(workItemSourceLabel("service_delivery")).toBe("Service exception");
    expect(workItemSourceLabel("inspection_war_room")).toBe("Inspection response request");
    expect(workItemSourceLabel("future_source")).toBe("Future Source");
  });

  it("uses an employee-specific self-service presentation for /me/work", () => {
    expect(workQueuePresentationForRole("employee")).toMatchObject({
      title: "My Work",
      showScopeSwitcher: false,
      showFacilityFilter: false,
      showOwnerFilter: false,
      showFacilityColumn: false,
      showSourceColumn: false,
      showOwnerColumn: false,
    });
  });

  it("keeps manager work queue controls and columns available", () => {
    expect(workQueuePresentationForRole("org_admin")).toMatchObject({
      title: "Operational Work Queue",
      showScopeSwitcher: true,
      showFacilityFilter: true,
      showOwnerFilter: true,
      showFacilityColumn: true,
      showSourceColumn: true,
      showOwnerColumn: true,
    });
    expect(workQueuePresentationForRole("auditor").showOwnerFilter).toBe(false);
  });
});
