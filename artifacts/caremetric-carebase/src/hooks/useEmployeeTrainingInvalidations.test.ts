import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), invalidate: vi.fn(), error: null as Error | null }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: h.invalidate }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (result: unknown) => unknown }) => ({
    mutateAsync: async (input: unknown) => { const result = await options.mutationFn(input); await options.onSuccess?.(result); return result; },
  }),
}));
import { useCreateEmployee, useUpdateEmployee } from "./useEmployees";
beforeEach(() => {
  vi.clearAllMocks(); h.error = null;
  h.from.mockImplementation(() => {
    const query = { insert: () => query, update: () => query, eq: () => query, select: () => query,
      single: async () => ({ data: h.error ? null : { id: "employee" }, error: h.error }) };
    return query;
  });
});
describe("staff writes refresh automatic Training assignment results", () => {
  it.each(["create", "update"] as const)("refreshes assignments, plan progress, reports and setup after successful %s", async action => {
    if (action === "create") await useCreateEmployee().mutateAsync({ first_name: "New", last_name: "Student", job_title: "Caregiver", facility_id: "facility", organization_id: "org" });
    else await useUpdateEmployee().mutateAsync({ id: "employee", job_title: "Caregiver", department: "Care" });
    const keys = h.invalidate.mock.calls.map(([arg]) => arg.queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["employees", "course_assignments", "training_plans", "training-enrollment-report", "training-workspace", "training-experience"]));
  });
  it.each(["create", "update"] as const)("never announces fresh data for rejected %s", async action => {
    h.error = new Error("Staff write denied");
    const operation = action === "create"
      ? useCreateEmployee().mutateAsync({ first_name: "New", last_name: "Student", job_title: "Caregiver", facility_id: "facility", organization_id: "org" })
      : useUpdateEmployee().mutateAsync({ id: "employee", job_title: "Caregiver" });
    await expect(operation).rejects.toThrow("Staff write denied");
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});
