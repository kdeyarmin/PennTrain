import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query }));
import { useEmployeeQualifications } from "./useEmployeeQualifications";
beforeEach(() => vi.clearAllMocks());
function setup(failAt?: number) {
  const calls: Array<{ table: string; select: string; filters: Record<string, string>; orders: unknown[]; range: number[]; signal?: AbortSignal }> = [];
  h.from.mockImplementation((table: string) => {
    const call = { table, select: "", filters: {} as Record<string, string>, orders: [] as unknown[], range: [0, 0], signal: undefined as AbortSignal | undefined }; calls.push(call);
    const q = { select: (value: string) => { call.select = value; return q; }, eq: (column: string, value: string) => { call.filters[column] = value; return q; }, order: (column: string, options?: unknown) => { call.orders.push([column, options]); return q; }, range: (start: number, end: number) => { call.range = [start, end]; return q; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: ["q1", "q2", "q3"].slice(call.range[0], call.range[0] + 2).map(id => ({ id })), error: call.range[0] === failAt ? new Error("Later page refused") : null })) }; return q;
  });
  return calls;
}
describe("issued employee qualification reads", () => {
  it("reads all scoped qualifications under a lower API cap with deterministic order and cancellation", async () => {
    const calls = setup(), signal = new AbortController().signal; useEmployeeQualifications("employee", "organization");
    const options = h.query.mock.calls[0][0];
    expect(options.queryKey).toEqual(["qualified-workforce", "qualifications", "organization", "employee"]);
    expect(await options.queryFn({ signal })).toEqual([{ id: "q1" }, { id: "q2" }, { id: "q3" }]);
    expect(calls.map(call => call.range)).toEqual([[0, 999], [2, 1001], [3, 1002]]);
    for (const call of calls) {
      expect(call.table).toBe("employee_qualifications"); expect(call.filters).toEqual({ organization_id: "organization", employee_id: "employee" });
      expect(call.orders).toEqual([["issued_at", { ascending: false }], ["id", undefined]]); expect(call.signal).toBe(signal);
      expect(call.select).toContain("definition:certification_definitions(name, qualification_key)");
    }
  });
  it("rejects the entire collection after a later page fails", async () => {
    setup(2); useEmployeeQualifications("employee", "organization");
    await expect(h.query.mock.calls[0][0].queryFn({ signal: new AbortController().signal })).rejects.toThrow("Later page refused");
  });
  it.each([["", "organization"], ["employee", ""]])("does not read without employee and organization scope (%s, %s)", async (employee, organization) => {
    useEmployeeQualifications(employee, organization); const options = h.query.mock.calls[0][0]; expect(options.enabled).toBe(false);
    expect(await options.queryFn({ signal: new AbortController().signal })).toEqual([]); expect(h.from).not.toHaveBeenCalled();
  });
});
