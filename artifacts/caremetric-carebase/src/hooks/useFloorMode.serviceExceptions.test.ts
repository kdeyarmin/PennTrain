import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useResidentServiceExceptions } from "./useFloorMode";

let calls: Array<{ filters: unknown[]; orFilters: string[]; orders: unknown[]; range?: [number, number] }>;
beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe("resident_service_task_instances");
    const call: typeof calls[number] = { filters: [], orFilters: [], orders: [] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      gte: (column: string, value: unknown) => { call.filters.push([column, "gte", value]); return query; },
      or: (filter: string) => { call.orFilters.push(filter); return query; },
      order: (column: string, options: unknown) => { call.orders.push([column, options]); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
    };
    return query;
  });
});

it("keeps a late as-planned delivery in the exception window", async () => {
  useResidentServiceExceptions("resident-a");
  const query = mocks.useQuery.mock.calls.at(-1)![0];
  expect(query.enabled).toBe(true);
  expect(query.queryKey[0]).toBe("resident-service-exceptions");
  await query.queryFn();
  expect(calls).toHaveLength(1);
  expect(calls[0].filters[0]).toEqual(["resident_id", "resident-a"]);
  expect(calls[0].orFilters).toEqual([
    "and(completion_response.not.is.null,completion_response.neq.completed_as_planned),status.eq.completed_late",
  ]);
  expect(calls[0].filters.some((filter) => Array.isArray(filter) && filter[0] === "performed_at" && filter[1] === "gte")).toBe(true);
  expect(calls[0].orders).toEqual([["performed_at", { ascending: false }], ["id", { ascending: false }]]);
  expect(calls[0].range).toEqual([0, 499]);
});

it("does not fetch service exceptions without a resident", () => {
  useResidentServiceExceptions(undefined);
  expect(mocks.useQuery.mock.calls.at(-1)![0].enabled).toBe(false);
});
