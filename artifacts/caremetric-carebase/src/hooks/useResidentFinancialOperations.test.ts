import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useResidentFinancialWorkspace } from "./useResidentFinancialOperations";
import { receivableAgingSummary } from "@/lib/residentBilling";

beforeEach(() => vi.clearAllMocks());

describe("resident financial ledger completeness", () => {
  function setup(failOlderPage = false) {
    const calls: Array<{ table: string; filters: Record<string, unknown>; range?: number[]; order: string[] }> = [];
    mocks.from.mockImplementation((table: string) => {
      const call = { table, filters: {} as Record<string, unknown>, range: undefined as number[] | undefined, order: [] as string[] };
      calls.push(call);
      let single = false;
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { call.filters[column] = value; return query; },
        in: () => query,
        order: (column: string) => { call.order.push(column); return query; },
        range: (from: number, to: number) => { call.range = [from, to]; return query; },
        limit: () => query,
        maybeSingle: () => { single = true; return query; },
        then: (resolve: (result: unknown) => unknown) => {
          const from = call.range?.[0] ?? 0;
          const data = table === "resident_financial_transactions"
            ? from === 0
              ? Array.from({ length: 1000 }, (_, index) => ({ id: `payment-${index}`, entry_side: "credit", amount: 1, effective_on: "2026-09-20" }))
              : [{ id: "older-charge", entry_side: "debit", amount: 1200, effective_on: "2026-07-01" }]
            : table === "resident_financial_statements"
              ? [{ id: "statement-a", period_end: "2026-07-31", due_date: "2026-08-01" }]
              : single ? null : [];
          return Promise.resolve(resolve({ data, error: failOlderPage && from === 1000 ? new Error("Ledger unavailable") : null }));
        },
      };
      return query;
    });
    useResidentFinancialWorkspace("resident-a");
    return { calls, queryFn: mocks.useQuery.mock.calls[0][0].queryFn };
  }

  it("includes older debt in the current balance and aging after 1000 recent payments", async () => {
    const { calls, queryFn } = setup();
    const workspace = await queryFn();
    expect(workspace.transactions).toHaveLength(1001);
    const aging = receivableAgingSummary(workspace, "2026-09-26");
    expect(aging.totalOpen).toBe(200);
    expect(aging.highestRiskBucket).toBe("days31To60");
    const financial = calls.filter((call) => call.table === "resident_financial_transactions");
    expect(financial.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of financial) {
      expect(call.filters).toEqual({ resident_id: "resident-a" });
      expect(call.order).toEqual(["effective_on", "posted_at", "id"]);
    }
  });

  it("surfaces an older-page failure instead of reporting a false credit balance", async () => {
    await expect(setup(true).queryFn()).rejects.toThrow("Ledger unavailable");
  });
});
