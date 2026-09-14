import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useMedicationIntegration, type MedicationIntegrationWorkspace } from "./useMedicationIntegration";

interface QueryCall {
  table: string;
  limit?: number;
  range?: [number, number];
  order: string[];
  filters: Array<[string, unknown]>;
}
let calls: QueryCall[];
let exceptionCount: number;
let failOffset: number | undefined;

beforeEach(() => {
  calls = [];
  exceptionCount = 101;
  failOffset = undefined;
  mocks.useQuery.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.from.mockReset().mockImplementation((table: string) => {
    const call: QueryCall = { table, order: [], filters: [] };
    calls.push(call);
    const query = {
      select: () => query,
      order: (column: string) => { call.order.push(column); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      limit: (count: number) => { call.limit = count; return query; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      then: (resolve: (result: unknown) => unknown) => {
        const [from, to] = call.range ?? [0, (call.limit ?? 1000) - 1];
        const isException = table === "medication_integration_exceptions";
        return Promise.resolve(resolve({
          data: isException && failOffset === from ? null : isException ? Array.from(
            { length: Math.max(0, Math.min(to + 1, exceptionCount) - from) },
            (_, index) => ({
              id: `exception-${from + index}`,
              status: from + index === exceptionCount - 1 ? "open" : "resolved",
              severity: from + index === exceptionCount - 1 ? "urgent" : "normal",
              last_seen_at: "2026-09-10T12:00:00Z",
            }),
          ) : [],
          error: isException && failOffset === from ? new Error("Medication exception page unavailable") : null,
        }));
      },
    };
    return query;
  });
});

const queryFn = () => (mocks.useQuery.mock.calls.at(-1)![0] as {
  queryFn: () => Promise<MedicationIntegrationWorkspace>;
}).queryFn();

describe("medication integration exception visibility", () => {
  it("keeps an unresolved urgent exception visible after 100 newer resolved ones", async () => {
    useMedicationIntegration("facility-a");
    const workspace = await queryFn();
    expect(workspace.exceptions.filter((row) => !["resolved", "dismissed"].includes(row.status)))
      .toEqual([expect.objectContaining({ id: "exception-100", status: "open", severity: "urgent" })]);
    expect(workspace.exceptions).toHaveLength(101);
  });

  it("pages beyond the API cap with stable ordering and the same facility scope", async () => {
    exceptionCount = 1001;
    useMedicationIntegration("facility-a");
    expect((await queryFn()).exceptions).toHaveLength(1001);
    const exceptionCalls = calls.filter((call) => call.table === "medication_integration_exceptions");
    expect(exceptionCalls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of exceptionCalls) {
      expect(call.order).toEqual(["last_seen_at", "id"]);
      expect(call.filters).toEqual([["facility_id", "facility-a"]]);
    }
  });

  it("shows a query error instead of a partial all-resolved list when the next page fails", async () => {
    exceptionCount = 1001;
    failOffset = 1000;
    useMedicationIntegration("facility-a");
    const outcome = await queryFn().then(() => "success", (error: Error) => error.message);
    expect(outcome).toBe("Medication exception page unavailable");
  });
});
