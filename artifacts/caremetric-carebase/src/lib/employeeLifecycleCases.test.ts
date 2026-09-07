import { describe, expect, it } from "vitest";
import {
  canApplyLifecycleCase,
  canCancelLifecycleCase,
  canRefreshLifecycleCase,
  defaultLifecycleTransition,
  lifecycleCasesToCsv,
  lifecyclePreviewAllowed,
  lifecyclePreviewReasons,
  lifecycleTransitionAdmitsStatus,
  lifecycleTransitionEligibleStatuses,
  summarizeLifecyclePreview,
  transitionRequiresTargetFacility,
} from "./employeeLifecycleCases";

describe("employee lifecycle case helpers", () => {
  it("gates apply/refresh/cancel by case status", () => {
    expect(canApplyLifecycleCase("ready")).toBe(true);
    expect(canApplyLifecycleCase("blocked")).toBe(false);
    expect(canRefreshLifecycleCase("blocked")).toBe(true);
    expect(canRefreshLifecycleCase("applied")).toBe(false);
    expect(canCancelLifecycleCase("ready")).toBe(true);
    expect(canCancelLifecycleCase("canceled")).toBe(false);
  });

  it("requires a target facility only for transfer", () => {
    expect(transitionRequiresTargetFacility("transfer")).toBe(true);
    expect(transitionRequiresTargetFacility("leave")).toBe(false);
  });

  it("summarizes preview blockers and effects", () => {
    expect(lifecyclePreviewAllowed({ allowed: true })).toBe(true);
    const lines = summarizeLifecyclePreview({
      allowed: false,
      blockers: ["Open schedule assignments must be reassigned"],
      effects: [{ type: "access", message: "Portal access will be suspended" }],
    });
    expect(lines[0]).toMatch(/blocked/i);
    expect(lines.some((line) => line.includes("Open schedule"))).toBe(true);
    expect(lines.some((line) => line.includes("Portal access"))).toBe(true);
  });

  it("exports a manager report CSV", () => {
    const csv = lifecycleCasesToCsv([
      {
        id: "c1",
        employee_id: "e1",
        transition: "leave",
        status: "ready",
        effective_on: "2026-07-30",
        reason: 'Medical leave, "FMLA"',
        applied_at: null,
        canceled_at: null,
      },
    ]);
    expect(csv).toContain("case_id,employee_id");
    expect(csv).toContain('"Medical leave, ""FMLA"""');
  });
});

describe("which employees a transition can be started for", () => {
  // preview_employee_lifecycle_transition requires `terminated` for rehire and `on_leave` for
  // return, and the wizard's picker was hard-scoped to active employees -- so both transitions
  // were listed in the dropdown and unreachable from anywhere in the product. Once somebody was
  // terminated or put on leave, nothing could bring them back.
  it("admits the statuses the server admits, per transition", () => {
    expect(lifecycleTransitionEligibleStatuses("rehire")).toEqual(["terminated"]);
    expect(lifecycleTransitionEligibleStatuses("return")).toEqual(["on_leave"]);
    expect(lifecycleTransitionEligibleStatuses("transfer")).toEqual(["active", "on_leave"]);
    expect(lifecycleTransitionEligibleStatuses("leave")).toEqual(["active"]);
    expect(lifecycleTransitionEligibleStatuses("restore_access")).toEqual(["active"]);
  });

  it("answers whether one employee is eligible for one transition", () => {
    expect(lifecycleTransitionAdmitsStatus("rehire", "terminated")).toBe(true);
    expect(lifecycleTransitionAdmitsStatus("rehire", "active")).toBe(false);
    expect(lifecycleTransitionAdmitsStatus("return", "on_leave")).toBe(true);
    expect(lifecycleTransitionAdmitsStatus("transfer", "on_leave")).toBe(true);
    expect(lifecycleTransitionAdmitsStatus("leave", null)).toBe(false);
  });

  it("opens an employee record on a transition that employee is eligible for", () => {
    expect(defaultLifecycleTransition("terminated")).toBe("rehire");
    expect(defaultLifecycleTransition("on_leave")).toBe("return");
    expect(defaultLifecycleTransition("active")).toBe("leave");
    for (const status of ["terminated", "on_leave", "active"]) {
      expect(lifecycleTransitionAdmitsStatus(defaultLifecycleTransition(status), status)).toBe(true);
    }
  });
});

describe("a blocked case says why", () => {
  // The preview returned `reasons` all along and the page never read it, so every blocked case --
  // whatever the cause -- said only "blocked until dependencies are resolved", naming no
  // dependency and offering no next step.
  it("renders the server's reason codes as readable sentences", () => {
    const lines = summarizeLifecyclePreview({
      allowed: false,
      reasons: ["rehire_requires_terminated_employee", "target_facility_outside_organization_or_inactive"],
    });
    expect(lines[0]).toMatch(/blocked/i);
    expect(lines.some((line) => line.includes("terminated employee"))).toBe(true);
    expect(lines.some((line) => line.includes("inactive or belongs to another organization"))).toBe(true);
  });

  it("shows an unrecognized code rather than dropping it", () => {
    const lines = lifecyclePreviewReasons({ reasons: ["some_new_server_reason"] });
    expect(lines).toEqual(["some new server reason"]);
  });

  it("has nothing to say about an allowed preview or a missing one", () => {
    expect(lifecyclePreviewReasons({ allowed: true, reasons: [] })).toEqual([]);
    expect(lifecyclePreviewReasons(null)).toEqual([]);
    expect(lifecyclePreviewReasons({ allowed: false })).toEqual([]);
  });
});
