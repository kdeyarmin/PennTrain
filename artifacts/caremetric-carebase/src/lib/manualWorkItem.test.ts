import { describe, expect, it } from "vitest";
import {
  manualDeduplicationKey,
  manualWorkItemIssues,
  templateObligations,
  WORK_ITEM_PRIORITIES,
  type ManualWorkItemForm,
  type WorkItemTemplateLike,
} from "./manualWorkItem";

const NOW = new Date("2026-08-04T12:00:00.000Z");

const form = (overrides: Partial<ManualWorkItemForm> = {}): ManualWorkItemForm => ({
  templateId: "tpl-1",
  facilityId: "fac-1",
  title: "Replace the fire extinguisher in B wing",
  description: "Gauge is in the red",
  priority: "high",
  dueAt: "2026-08-11T12:00:00.000Z",
  ...overrides,
});

const template = (overrides: Partial<WorkItemTemplateLike> = {}): WorkItemTemplateLike => ({
  id: "tpl-1",
  template_key: "maintenance.generic",
  name: "Maintenance follow-up",
  source_type: "rule_exception",
  default_priority: "normal",
  required_evidence_types: [],
  approval_required: false,
  ...overrides,
});

describe("manualWorkItemIssues", () => {
  it("accepts a complete form", () => {
    expect(manualWorkItemIssues(form(), NOW)).toEqual([]);
  });

  it("insists on a template, naming why it matters", () => {
    expect(manualWorkItemIssues(form({ templateId: "" }), NOW))
      .toContainEqual(expect.stringMatching(/evidence needed to close/i));
  });

  it("requires a facility", () => {
    expect(manualWorkItemIssues(form({ facilityId: "" }), NOW)).toHaveLength(1);
  });

  it("rejects a whitespace-only title, which would otherwise store an empty string", () => {
    expect(manualWorkItemIssues(form({ title: "   " }), NOW)).toHaveLength(1);
    expect(manualWorkItemIssues(form({ title: "ab" }), NOW)).toHaveLength(1);
    expect(manualWorkItemIssues(form({ title: "abc" }), NOW)).toEqual([]);
  });

  it("only allows priorities the check constraint allows", () => {
    for (const priority of WORK_ITEM_PRIORITIES) {
      expect(manualWorkItemIssues(form({ priority }), NOW)).toEqual([]);
    }
    expect(manualWorkItemIssues(form({ priority: "critical" }), NOW)).toHaveLength(1);
  });

  it("treats an empty priority as 'use the template default', not as invalid", () => {
    expect(manualWorkItemIssues(form({ priority: "" }), NOW)).toEqual([]);
  });

  it("refuses a due date already in the past", () => {
    expect(manualWorkItemIssues(form({ dueAt: "2026-08-01T00:00:00.000Z" }), NOW))
      .toContainEqual(expect.stringMatching(/opens overdue/i));
  });

  it("treats an empty due date as 'use the template interval'", () => {
    expect(manualWorkItemIssues(form({ dueAt: "" }), NOW)).toEqual([]);
  });

  it("reports every problem at once", () => {
    expect(manualWorkItemIssues(form({ templateId: "", facilityId: "", title: "" }), NOW))
      .toHaveLength(3);
  });
});

describe("manualDeduplicationKey", () => {
  it("collapses the same title to the same key, so a double submit makes one item", () => {
    expect(manualDeduplicationKey("maintenance.generic", "Replace the extinguisher"))
      .toBe(manualDeduplicationKey("maintenance.generic", "  Replace  the   Extinguisher!  "));
  });

  it("separates genuinely different titles", () => {
    expect(manualDeduplicationKey("maintenance.generic", "Replace the extinguisher"))
      .not.toBe(manualDeduplicationKey("maintenance.generic", "Replace the smoke alarm"));
  });

  it("separates the same title under different templates", () => {
    expect(manualDeduplicationKey("maintenance.generic", "Check the door"))
      .not.toBe(manualDeduplicationKey("safety.generic", "Check the door"));
  });

  it("is namespaced so it cannot collide with an automatic source's key", () => {
    expect(manualDeduplicationKey("maintenance.generic", "x")).toMatch(/^manual:/);
  });

  it("stays bounded for a very long title", () => {
    expect(manualDeduplicationKey("t", "a".repeat(500)).length).toBeLessThan(120);
  });
});

describe("templateObligations", () => {
  it("says nothing about a template that was not chosen", () => {
    expect(templateObligations(undefined)).toEqual([]);
  });

  it("names the evidence closure will demand", () => {
    expect(templateObligations(template({ required_evidence_types: ["photo", "signature"] }))[0])
      .toContain("photo, signature");
  });

  it("mentions an approval step", () => {
    expect(templateObligations(template({ approval_required: true })))
      .toContainEqual(expect.stringMatching(/approval step/i));
  });

  it("says so explicitly when a template demands nothing, rather than staying silent", () => {
    expect(templateObligations(template())).toEqual([
      expect.stringMatching(/no closure evidence or approval/i),
    ]);
  });

  it("reports both obligations when a template has them", () => {
    expect(templateObligations(template({
      required_evidence_types: ["photo"],
      approval_required: true,
    }))).toHaveLength(2);
  });
});
