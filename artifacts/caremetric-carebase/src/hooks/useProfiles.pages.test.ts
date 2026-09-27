import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useListProfiles } from "./useProfiles";

const PAGE = 1000;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useQuery.mockImplementation(() => ({ data: undefined, isLoading: false, isError: false, error: null }));
});

it("keeps a profile past the first thousand, in surname order with an id tie-break", async () => {
  const ranges: Array<[number, number]> = [];
  const orders: string[] = [];
  mocks.from.mockImplementation(() => {
    const query = {
      select: () => query,
      order: (column: string) => { orders.push(column); return query; },
      eq: () => query,
      range: (from: number, through: number) => {
        ranges.push([from, through]);
        const data = ranges.length === 1
          ? Array.from({ length: PAGE }, (_, index) => ({ id: `p-${index}`, last_name: "A" }))
          : [{ id: "p-last", last_name: "Z" }];
        return Promise.resolve({ data, error: null });
      },
    };
    return query;
  });

  useListProfiles({ organizationId: "55555555-5555-4555-8555-555555555555" });
  const rows = await mocks.useQuery.mock.calls.at(-1)![0].queryFn();
  expect(orders).toEqual(["last_name", "id", "last_name", "id"]);
  expect(ranges).toEqual([[0, PAGE - 1], [PAGE, PAGE * 2 - 1]]);
  expect(rows.at(-1).id).toBe("p-last");
  expect(rows).toHaveLength(PAGE + 1);
});
