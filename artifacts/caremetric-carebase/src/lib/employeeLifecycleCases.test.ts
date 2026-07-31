import { describe, expect, it } from "vitest";
import {
  canApplyLifecycleCase,
  canCancelLifecycleCase,
  canRefreshLifecycleCase,
  lifecycleCasesToCsv,
  lifecyclePreviewAllowed,
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
