import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ from: vi.fn(), result: vi.fn(), signal: null as AbortSignal | null, filters: [] as unknown[], select: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
import { invalidateCompletedCourseEvidence, verifyCourseAssignmentCompleted } from "./useCourseAssignments";
import type { QueryClient } from "@tanstack/react-query";

beforeEach(() => {
  h.signal = null; h.filters = []; h.from.mockReset(); h.result.mockReset(); h.select.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
  const query = {
    select: (columns: string) => { h.select(columns); return query; },
    eq: (column: string, value: string) => { h.filters.push([column, value]); return query; },
    abortSignal: (signal: AbortSignal) => { h.signal = signal; return query; },
    maybeSingle: h.result,
  };
  h.from.mockReturnValue(query);
  h.result.mockResolvedValue({ data: { id: "assignment-a", employee_id: "employee-a", status: "completed" }, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("authoritative completion recovery", () => {
  it("reads only the exact assignment and employee and confirms committed completion", async () => {
    expect(await verifyCourseAssignmentCompleted("assignment-a", "employee-a")).toBe(true);
    expect(h.from).toHaveBeenCalledWith("course_assignments");
    expect(h.select).toHaveBeenCalledWith("id,employee_id,status");
    expect(h.filters).toEqual([["id", "assignment-a"], ["employee_id", "employee-a"]]);
    expect(h.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    null,
    { id: "other-assignment", employee_id: "employee-a", status: "completed" },
    { id: "assignment-a", employee_id: "other-employee", status: "completed" },
    { id: "assignment-a", employee_id: "employee-a", status: "in_progress" },
  ])("does not accept missing, mismatched, or uncompleted evidence: %j", async (data) => {
    h.result.mockResolvedValue({ data, error: null });
    expect(await verifyCourseAssignmentCompleted("assignment-a", "employee-a")).toBe(false);
  });

  it("does not accept completed data accompanying a failed read", async () => {
    h.result.mockResolvedValue({ data: { id: "assignment-a", employee_id: "employee-a", status: "completed" }, error: new Error("Read failed") });
    await expect(verifyCourseAssignmentCompleted("assignment-a", "employee-a")).rejects.toThrow("Read failed");
  });

  it("fails fast offline instead of pausing the player's completion state until reconnect", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(await verifyCourseAssignmentCompleted("assignment-a", "employee-a")).toBe(false);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("aborts and returns after its deadline even if connectivity fails after the read starts", async () => {
    vi.useFakeTimers();
    h.result.mockImplementation(() => new Promise(() => {}));
    const pending = verifyCourseAssignmentCompleted("assignment-a", "employee-a");
    vi.stubGlobal("navigator", { onLine: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe(false);
    expect(h.signal?.aborted).toBe(true);
  });

  it("refreshes issued certificates and compliance after verified recovery without another write", () => {
    const invalidateQueries = vi.fn();
    invalidateCompletedCourseEvidence({ invalidateQueries } as unknown as QueryClient);
    expect(invalidateQueries.mock.calls.map(([input]) => input.queryKey[0])).toEqual([
      "course_assignments", "course_progress", "certificates", "training_records", "training_hour_buckets", "alerts", "org_dashboard_summary",
      // record_course_completion_credits (trigger) writes the per-course credit rows the employee page lists.
      "course_completion_credits",
    ]);
    expect(h.from).not.toHaveBeenCalled();
  });
});
