import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), createAssignment: vi.fn(), invalidateQueries: vi.fn(),
  plan: { data: { facility_id: "facility-a" }, error: null as Error | null },
  items: [] as { id: string; course_id: string | null; training_type_id: string | null }[],
  courses: [] as { id: string; title: string; status: string; current_version_id: string | null }[],
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock("./useCourseAssignments", () => ({ useCreateCourseAssignment: () => ({ mutateAsync: h.createAssignment }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (result: unknown) => unknown }) => ({
    mutateAsync: async (input: unknown) => {
      const result = await options.mutationFn(input);
      await options.onSuccess?.(result);
      return result;
    },
  }),
}));

import { useApplyTrainingPlanToEmployee } from "./useTrainingPlans";
const input = { planId: "plan-a", employeeId: "employee-a", facilityId: "facility-a", organizationId: "org-a", assignedBy: "admin-a" };

beforeEach(() => {
  vi.clearAllMocks();
  h.plan = { data: { facility_id: "facility-a" }, error: null };
  h.items = [{ id: "item-a", course_id: "course-a", training_type_id: null }];
  h.courses = [{ id: "course-a", title: "Fire safety", status: "published", current_version_id: "version-a" }];
  h.createAssignment.mockResolvedValue({ alreadyAssigned: false, assignment: { id: "new-assignment" } });
  h.rpc.mockResolvedValue({ data: { assigned: 2, updated: 1, canceled: 1, already_completed: 1, conflicts: [] }, error: null });
  h.from.mockImplementation((table: string) => {
    const response = () => table === "training_plans" ? h.plan
      : { data: table === "training_plan_items" ? h.items : table === "courses" ? h.courses : [], error: null };
    const query = {
      select: () => query, eq: () => query, in: () => query,
      single: async () => response(),
      insert: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(response()).then(resolve, reject),
    };
    return query;
  });
});

describe("yearly plan application", () => {
  it("uses the atomic server operation and stored plan deadline, never the legacy client fan-out", async () => {
    const result = await useApplyTrainingPlanToEmployee().mutateAsync({ ...input, dueDate: "2030-01-01" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("apply_yearly_training_plan", { p_plan_id: "plan-a", p_employee_id: "employee-a" });
    expect(h.createAssignment).not.toHaveBeenCalled();
    expect(h.from.mock.calls.map(([table]) => table)).toEqual(["training_plans"]);
    expect(result).toMatchObject({ assigned: 2, updated: 1, canceled: 1, alreadyCompleted: 1, conflicts: [], failed: [] });
    expect(h.invalidateQueries.mock.calls.map(([options]) => options.queryKey[0])).toEqual([
      "course_assignments", "training_plans", "training-enrollment-report", "alerts",
    ]);
  });
  it("returns unrelated enrollment conflicts and their original dates for visible review", async () => {
    const conflict = { course_id: "course-a", title: "Fire safety", assignment_id: "unrelated", due_date: "2026-10-10" };
    h.rpc.mockResolvedValue({ data: { assigned: 0, updated: 0, canceled: 0, already_completed: 0, conflicts: [conflict] }, error: null });
    expect((await useApplyTrainingPlanToEmployee().mutateAsync(input)).conflicts).toEqual([conflict]);
    expect(h.createAssignment).not.toHaveBeenCalled();
  });
  it("surfaces denied or failed atomic application without falling back to partial inserts", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("Employee outside plan facility") });
    await expect(useApplyTrainingPlanToEmployee().mutateAsync(input)).rejects.toThrow("outside plan facility");
    expect(h.createAssignment).not.toHaveBeenCalled();
    expect(h.invalidateQueries).not.toHaveBeenCalled();
  });
  it("fails closed if the saved plan cannot be read", async () => {
    h.plan.error = new Error("Plan unavailable");
    await expect(useApplyTrainingPlanToEmployee().mutateAsync(input)).rejects.toThrow("Plan unavailable");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.createAssignment).not.toHaveBeenCalled();
  });
});

describe("legacy plan compatibility", () => {
  beforeEach(() => { h.plan.data.facility_id = null as unknown as string; });
  it.each([undefined, "", "2027-02-29"])("requires an explicit valid deadline (%s)", dueDate => {
    return expect(useApplyTrainingPlanToEmployee().mutateAsync({ ...input, dueDate })).rejects.toThrow("Enter a completion deadline");
  });
  it("passes the entered date unchanged into new course assignments", async () => {
    const result = await useApplyTrainingPlanToEmployee().mutateAsync({ ...input, dueDate: "2027-03-17" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.createAssignment).toHaveBeenCalledExactlyOnceWith({ employee_id: "employee-a", course_id: "course-a", course_version_id: "version-a",
      facility_id: "facility-a", organization_id: "org-a", assigned_by: "admin-a", due_date: "2027-03-17", training_plan_id: "plan-a", training_plan_item_id: "item-a" });
    expect(result).toMatchObject({ assigned: 1, alreadyAssigned: 0, failed: [] });
  });
  it("reports an existing open assignment honestly and does not send a duplicate plan alert", async () => {
    h.createAssignment.mockResolvedValue({ alreadyAssigned: true, assignment: { id: "existing", due_date: "2026-09-01" } });
    const result = await useApplyTrainingPlanToEmployee().mutateAsync({ ...input, dueDate: "2027-03-17" });
    expect(result).toMatchObject({ assigned: 0, alreadyAssigned: 1 });
    expect(h.from).not.toHaveBeenCalledWith("alerts");
  });
  it("collects an unpublished item failure while reporting another course that was assigned", async () => {
    h.items.push({ id: "item-b", course_id: "course-b", training_type_id: null });
    h.courses.push({ id: "course-b", title: "Archived training", status: "archived", current_version_id: "version-b" });
    const result = await useApplyTrainingPlanToEmployee().mutateAsync({ ...input, dueDate: "2027-03-17" });
    expect(result.assigned).toBe(1);
    expect(result.failed).toEqual([{ itemId: "item-b", itemLabel: "Archived training", message: '"Archived training" is archived and cannot be assigned. Publish it, or remove it from this plan.' }]);
    expect(h.createAssignment).toHaveBeenCalledOnce();
  });
});
