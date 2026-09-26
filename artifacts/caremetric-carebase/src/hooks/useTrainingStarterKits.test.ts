import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (value: unknown) => unknown }) => ({
    mutateAsync: async (input: unknown) => { const value = await options.mutationFn(input); await options.onSuccess?.(value); return value; },
  }),
}));
import { useApplyTrainingAssignmentRule, useApproveTrainingAssignmentAutomation, useCopyTrainingStarterKit, usePreviewTrainingAssignmentRule, useSaveTrainingAssignmentRule, useSelectTrainingStarterKit } from "./useTrainingStarterKits";
beforeEach(() => { vi.clearAllMocks(); h.rpc.mockResolvedValue({ data: "created-plan", error: null }); });
describe("reviewed starter-kit and assignment boundaries", () => {
  it("copies with the administrator's exact entered date and reviewed revision in one atomic operation", async () => {
    await useCopyTrainingStarterKit().mutateAsync({ selectionId: "selection", revision: 3, name: "Orientation", year: 2030, deadline: "2031-01-12" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("copy_training_starter_kit", { p_selection_id: "selection", p_revision: 3, p_name: "Orientation", p_training_year: 2030, p_due_date: "2031-01-12" });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.invalidate.mock.calls.map(([arg]) => arg.queryKey)).toEqual([["training_plans"], ["training-starter-selections"]]);
  });
  it("does not fall back to partial copying when a reviewed kit revision has changed", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Starter kit changed; review the current courses before copying", code: "40001" } });
    await expect(useCopyTrainingStarterKit().mutateAsync({ selectionId: "selection", revision: 1, name: "Orientation", year: 2030, deadline: "2030-12-12" })).rejects.toThrow("Starter kit changed");
    expect(h.rpc).toHaveBeenCalledTimes(1); expect(h.from).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled();
  });
  it("offering a kit does not apply courses or send an invitation", async () => {
    await useSelectTrainingStarterKit().mutateAsync({ facilityId: "facility", kitId: "kit" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("select_training_starter_kit", { p_facility_id: "facility", p_kit_id: "kit" });
    expect(h.from).not.toHaveBeenCalled();
  });
  it("saves normalized matching inputs and lets the server clear any previous automatic approval", async () => {
    await useSaveTrainingAssignmentRule().mutateAsync({ planId: "plan", jobTitle: "  Caregiver ", department: "", enabled: true, revision: 2 });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("save_training_assignment_rule", { p_plan_id: "plan", p_job_title: "Caregiver", p_department: "", p_is_enabled: true, p_revision: 2 });
  });
  it("preview never mutates assignment tables or approves automatic application", async () => {
    const data = { fingerprint: "reviewed", employees: [], can_apply: true };
    h.rpc.mockResolvedValue({ data, error: null });
    expect(await usePreviewTrainingAssignmentRule().mutateAsync("plan")).toEqual(data);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("preview_training_assignment_rule", { p_plan_id: "plan" });
    expect(h.from).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled();
  });
  it("sends only selected employees and the exact preview; stale review failures never fall back to per-employee writes", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Plan, rule or employee assignments changed; refresh the preview" } });
    await expect(useApplyTrainingAssignmentRule().mutateAsync({ planId: "plan", fingerprint: "reviewed", employeeIds: ["selected"] })).rejects.toThrow("refresh the preview");
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("apply_training_assignment_rule", { p_plan_id: "plan", p_fingerprint: "reviewed", p_employee_ids: ["selected"] });
    expect(h.from).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled();
  });
  it("automatic opt-in is a separate explicit operation that carries the current review fingerprint", async () => {
    await useApproveTrainingAssignmentAutomation().mutateAsync({ planId: "plan", fingerprint: "reviewed", enabled: true });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("approve_training_assignment_automation", { p_plan_id: "plan", p_fingerprint: "reviewed", p_enabled: true });
    expect(h.from).not.toHaveBeenCalled();
  });
});
