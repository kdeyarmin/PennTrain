import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useResidentFinancialWorkspace, useUnsettledPersonalFundAccounts } from "./useResidentFinancialOperations";
import { receivableAgingSummary } from "@/lib/residentBilling";

beforeEach(() => vi.clearAllMocks());

describe("resident financial ledger completeness", () => {
  function setup(failOlderPage = false, serverCap = 1000) {
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
          const all = table === "resident_financial_transactions"
            ? [...Array.from({ length: serverCap === 1000 ? 1000 : 3 }, (_, index) => ({ id: `payment-${index}`, entry_side: "credit", amount: 1, effective_on: "2026-09-20" })),
              { id: "older-charge", entry_side: "debit", amount: 1200, effective_on: "2026-07-01" }]
            : table === "resident_financial_statements"
              ? Array.from({ length: 3 }, (_, index) => ({ id: `statement-${index}`, period_end: "2026-07-31", due_date: "2026-08-01" }))
              : table === "resident_personal_fund_transactions"
                ? Array.from({ length: 3 }, (_, index) => ({ id: `fund-${index}`, balance_after: index }))
              : single ? null : [];
          const data = all?.slice(from, from + serverCap) ?? null;
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
    expect(financial.map((call) => call.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
    for (const call of financial) {
      expect(call.filters).toEqual({ resident_id: "resident-a" });
      expect(call.order).toEqual(["effective_on", "posted_at", "id"]);
    }
  });

  it("surfaces an older-page failure instead of reporting a false credit balance", async () => {
    await expect(setup(true).queryFn()).rejects.toThrow("Ledger unavailable");
  });
  it("reads every ledger and statement page when the server returns only two rows", async () => {
    const { calls, queryFn } = setup(false, 2); const workspace = await queryFn();
    expect(workspace.transactions.map((row: { id: string }) => row.id)).toEqual(["payment-0", "payment-1", "payment-2", "older-charge"]);
    expect(workspace.statements).toHaveLength(3); expect(workspace.fundTransactions).toHaveLength(3);
    expect(receivableAgingSummary(workspace, "2026-09-26").totalOpen).toBe(1197);
    expect(calls.filter(call => call.table === "resident_financial_transactions").map(call => call.range?.[0])).toEqual([0, 2, 4]);
    for (const table of ["resident_financial_statements", "resident_personal_fund_transactions"]) {
      expect(calls.filter(call => call.table === table).map(call => call.range?.[0])).toEqual([0, 2, 3]);
    }
  });
  it("finds an unsettled discharged account behind a capped page of closed accounts", async () => {
    const ranges: number[] = [];
    const accounts = ["closed-a", "closed-b", "unsettled"].map(id => ({ id, resident_id: `resident-${id}`, account_number: id, beginning_balance: 25, resident: { last_name: id, first_name: "Pat", room: null, status: "discharged" } }));
    mocks.from.mockImplementation((table: string) => {
      let from = 0; let ids: string[] = [];
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query, maybeSingle: () => query,
        in: (column: string, values: string[]) => { if (column === "personal_fund_account_id") ids = values; return query; },
        range: (start: number) => { from = start; ranges.push(start); return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ error: null, data: table === "resident_personal_fund_accounts" ? accounts.slice(from, from + 2)
          : table === "resident_personal_fund_account_closures" ? ids.filter(id => id.startsWith("closed")).map(id => ({ personal_fund_account_id: id })) : null })),
      }; return query;
    });
    useUnsettledPersonalFundAccounts("facility-a");
    const result = await mocks.useQuery.mock.calls[0][0].queryFn();
    expect(result.truncated).toBe(false); expect(result.accounts).toMatchObject([{ accountId: "unsettled", residentId: "resident-unsettled", balance: 25 }]);
    expect(ranges).toEqual([0, 2, 3]);
  });
});
