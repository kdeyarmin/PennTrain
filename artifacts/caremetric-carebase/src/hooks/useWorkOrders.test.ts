import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListWorkOrders } from "./useWorkOrders";

beforeEach(() => vi.clearAllMocks());

describe("maintenance work queue completeness", () => {
  function setup(failSecondPage = false) {
    const calls: Array<{ range?: number[]; order: string[]; filters: Record<string, unknown> }> = [];
    mocks.from.mockImplementation(() => {
      const call = { range: undefined as number[] | undefined, order: [] as string[], filters: {} as Record<string, unknown> };
      calls.push(call);
      const query = {
        select: () => query,
        order: (column: string) => { call.order.push(column); return query; },
        eq: (column: string, value: unknown) => { call.filters[column] = value; return query; },
        range: (from: number, to: number) => { call.range = [from, to]; return query; },
        then: (resolve: (result: unknown) => unknown) => {
          const from = call.range?.[0] ?? 0;
          return Promise.resolve(resolve(failSecondPage && from === 1000
            ? { data: null, error: new Error("Next page unavailable") }
            : { error: null, data: from === 0
              ? Array.from({ length: 1000 }, (_, id) => ({ id: `closed-${id}`, status: "verified" }))
              : from === 1000 ? [{ id: "old-open-repair", status: "open" }] : [] }));
        },
      };
      return query;
    });
    useListWorkOrders({ facilityId: "facility-a", priority: "urgent", inspectionItemId: "asset-a" });
    return { calls, queryFn: mocks.useQuery.mock.calls[0][0].queryFn };
  }

  it("retains an old open repair after 1000 newer closed orders", async () => {
    const { calls, queryFn } = setup();
    const orders = await queryFn();
    expect(orders).toHaveLength(1001);
    expect(orders.at(-1)).toEqual({ id: "old-open-repair", status: "open" });
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
    for (const call of calls) {
      expect(call.order).toEqual(["created_at", "id"]);
      expect(call.filters).toEqual({ facility_id: "facility-a", priority: "urgent", inspection_item_id: "asset-a" });
    }
  });

  it("fails visibly rather than showing a misleading partial queue", async () => {
    await expect(setup(true).queryFn()).rejects.toThrow("Next page unavailable");
  });
});
