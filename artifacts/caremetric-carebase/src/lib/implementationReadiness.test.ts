import { describe, expect, it } from "vitest";
import {
  implementationTaskNeedsAttention,
  implementationTaskRoute,
  summarizeImplementationReadiness,
  type ImplementationTaskLike,
} from "./implementationReadiness";

function task(overrides: Partial<ImplementationTaskLike> = {}): ImplementationTaskLike {
  return {
    task_key: "org-profile",
    title: "Confirm organization",
    status: "not_started",
    required: true,
    due_date: null,
    owner_profile_id: null,
    evidence_note: null,
    ...overrides,
  };
}

describe("implementation readiness", () => {
  const now = new Date("2026-07-29T12:00:00-04:00");

  it("scores required tasks and treats approved not-applicable work as settled", () => {
    const summary = summarizeImplementationReadiness([
      task({ task_key: "a", status: "complete" }),
      task({ task_key: "b", status: "not_applicable" }),
      task({ task_key: "c", status: "in_progress" }),
      task({ task_key: "optional", required: false, status: "not_started" }),
    ], now);

    expect(summary).toMatchObject({
      total: 4,
      required: 3,
      requiredComplete: 2,
      launchBlockers: 1,
      percent: 67,
      ready: false,
    });
  });

  it("separates blocked and overdue tasks", () => {
    const summary = summarizeImplementationReadiness([
      task({ task_key: "blocked", status: "blocked", due_date: "2026-08-01" }),
      task({ task_key: "overdue", status: "in_progress", due_date: "2026-07-01" }),
      task({ task_key: "done", status: "complete", due_date: "2026-07-01" }),
    ], now);
    expect(summary.blocked).toBe(1);
    expect(summary.overdue).toBe(1);
    expect(implementationTaskNeedsAttention(task({ status: "blocked" }), now)).toBe(true);
    expect(implementationTaskNeedsAttention(task({ status: "complete", due_date: "2026-07-01" }), now)).toBe(false);
  });

  it("is ready when every required task is complete or not applicable", () => {
    const summary = summarizeImplementationReadiness([
      task({ status: "complete" }),
      task({ task_key: "b", status: "not_applicable" }),
    ], now);
    expect(summary.ready).toBe(true);
    expect(summary.percent).toBe(100);
  });

  it("provides validation routes for each go-live milestone", () => {
    expect(implementationTaskRoute("roster-import")).toBe("/app/employees?action=bulk-import");
    expect(implementationTaskRoute("notification-test")).toBe("/account/notifications");
    expect(implementationTaskRoute("survey-rehearsal")).toBe("/app/survey-day");
    expect(implementationTaskRoute("unknown")).toBeNull();
  });
});
