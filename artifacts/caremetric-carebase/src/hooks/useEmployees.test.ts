import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useListEmployees, useListEmployeesPaginated } from "./useEmployees";

interface QuerySpec { queryFn: () => Promise<unknown>; enabled?: boolean }
interface PageCall {
  range?: [number, number];
  order: string[];
  filters: Array<[string, unknown]>;
}

let calls: PageCall[];
let employeeCount: number;
let failOffset: number | undefined;

beforeEach(() => {
  calls = [];
  employeeCount = 1005;
  failOffset = undefined;
  mocks.useQuery.mockReset();
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => {
    const call: PageCall = { order: [], filters: [] };
    calls.push(call);
    const query = {
      select: () => query,
      order: (column: string) => { call.order.push(column); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      in: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const [from, to] = call.range ?? [0, 999];
        return Promise.resolve(resolve({
          data: failOffset === from ? null : Array.from(
            { length: Math.max(0, Math.min(to + 1, employeeCount) - from) },
            (_, index) => ({ id: `employee-${from + index}`, last_name: "Smith" }),
          ),
          error: failOffset === from ? new Error("Roster page unavailable") : null,
          count: employeeCount,
        }));
      },
    };
    return query;
  });
});

const querySpec = () => mocks.useQuery.mock.calls.at(-1)![0] as QuerySpec;

describe("complete employee roster queries", () => {
  it("includes the staff beyond the API cap in bulk-assignment and report pickers", async () => {
    useListEmployees({ organizationId: "org-a", status: "active", trainerStatus: false });
    const rows = await querySpec().queryFn() as Array<{ id: string }>;
    expect(rows).toHaveLength(1005);
    expect(rows.at(-1)?.id).toBe("employee-1004");
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of calls) {
      expect(call.order).toEqual(["last_name", "id"]);
      expect(call.filters).toContainEqual(["organization_id", "org-a"]);
      expect(call.filters).toContainEqual(["status", "active"]);
      expect(call.filters).toContainEqual(["trainer_status", false]);
    }
  });

  it("rejects an incomplete roster when a later page fails", async () => {
    failOffset = 1000;
    useListEmployees({ facilityId: "facility-a" });
    await expect(querySpec().queryFn()).rejects.toThrow("Roster page unavailable");
  });

  it("finishes an exact-cap roster after checking for another page", async () => {
    employeeCount = 1000;
    useListEmployees();
    expect(await querySpec().queryFn()).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("preserves the caller's disabled state while the organization is unresolved", () => {
    useListEmployees({}, { enabled: false });
    expect(querySpec().enabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps the trainer filter when using the paginated roster", async () => {
    useListEmployeesPaginated({ trainerStatus: true, page: 2, pageSize: 15 });
    await querySpec().queryFn();
    expect(calls[0].filters).toContainEqual(["trainer_status", true]);
    expect(calls[0].range).toEqual([15, 29]);
  });
});
