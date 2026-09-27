import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), failAt: -1, calls: [] as Array<{ table: string; range: number[]; orders: unknown[]; filters: unknown[] }> }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListEmployeeCredentials } from "./useEmployeeCredentials";
import { useListCompetencyRecords } from "./useCompetencies";
beforeEach(() => {
  h.calls = []; h.failAt = -1; vi.clearAllMocks();
  h.from.mockImplementation((table: string) => {
    const call = { table, range: [] as number[], orders: [] as unknown[], filters: [] as unknown[] }; h.calls.push(call);
    const query = { select: () => query, order: (column: string, options: unknown) => { call.orders.push([column, options]); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [0, 1, 2].slice(call.range[0], call.range[0] + 2).map(id => ({ id: `${table}-${id}` })), error: call.range[0] === h.failAt ? new Error("History failed") : null }).then(resolve),
    }; return query;
  });
});
const cases = [
  { label: "credentials", read: () => useListEmployeeCredentials({ employeeId: "employee", facilityId: "facility", credentialType: "other", status: "valid" }),
    filters: [["employee_id", "employee"], ["facility_id", "facility"], ["credential_type", "other"], ["status", "valid"]], order: [["expiration_date", undefined], ["id", { ascending: true }]] },
  { label: "competencies", read: () => useListCompetencyRecords({ employeeId: "employee", facilityId: "facility", templateId: "template" }),
    filters: [["employee_id", "employee"], ["facility_id", "facility"], ["template_id", "template"]], order: [["evaluation_date", { ascending: false }], ["id", { ascending: false }]] },
];
describe.each(cases)("complete $label history", ({ read, filters, order }) => {
  const fetch = () => (read() as unknown as { queryFn: () => Promise<unknown[]> }).queryFn();
  it("includes historical records below the requested API cap and preserves every scope filter", async () => {
    expect(await fetch()).toHaveLength(3);
    expect(h.calls.map(call => call.range)).toEqual([[0, 999], [2, 1001], [3, 1002]]);
    h.calls.forEach(call => { expect(call.filters).toEqual(filters); expect(call.orders).toEqual(order); });
  });
  it("rejects a failed later page instead of showing incomplete compliance history", async () => {
    h.failAt = 2; await expect(fetch()).rejects.toThrow("History failed");
  });
});
