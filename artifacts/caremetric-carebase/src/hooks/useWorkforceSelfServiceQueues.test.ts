import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useWorkforceSelfServiceQueues } from "./useDailyOperations";
beforeEach(() => vi.clearAllMocks());
const tables = ["workforce_time_off_requests", "open_shift_claims", "shift_swap_requests"];
function setup(failedTable?: string) {
  const calls: Array<{ table: string; from: number; filters: unknown[]; order: string[]; signal?: AbortSignal }> = [];
  h.from.mockImplementation((table: string) => {
    const call = { table, from: 0, filters: [] as unknown[], order: [] as string[], signal: undefined as AbortSignal | undefined }; calls.push(call);
    const q = { select: () => q, eq: (key: string, value: string) => { call.filters.push([key, value]); return q; }, in: (key: string, value: string[]) => { call.filters.push([key, value]); return q; }, order: (key: string) => { call.order.push(key); return q; }, range: (from: number) => { call.from = from; return q; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [1, 2, 3].slice(call.from, call.from + 2).map(id => ({ id })), error: table === failedTable && call.from === 2 ? new Error("Later queue page failed") : null })) };
    return q;
  }); return calls;
}
describe("complete scoped workforce decision queues", () => {
  it("retains every pending request with actual-count paging and scope on every page", async () => {
    const calls = setup(), signal = new AbortController().signal; useWorkforceSelfServiceQueues("facility", { organizationId: "organization" });
    const options = h.query.mock.calls[0][0], result = await options.queryFn({ signal });
    expect(options.queryKey).toEqual(["workforce-self-service-queues", "facility", "organization"]);
    expect([result.timeOff.length, result.openShiftClaims.length, result.shiftSwaps.length]).toEqual([3, 3, 3]);
    for (const table of tables) expect(calls.filter(call => call.table === table).map(call => call.from)).toEqual([0, 2, 3]);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["organization_id", "organization"]); expect(call.filters).toContainEqual([call.table === "open_shift_claims" ? "open_shift_opportunities.facility_id" : "facility_id", "facility"]);
      expect(call.filters).toContainEqual(call.table === "open_shift_claims" ? ["claim_status", ["pending_approval", "waitlisted"]] : ["status", "pending"]);
      expect(call.order).toEqual([call.table === "workforce_time_off_requests" ? "starts_at" : "requested_at", "id"]); expect(call.signal).toBe(signal);
    }
  });
  it.each(tables)("does not show partial queues when a later %s page fails", async table => {
    setup(table); useWorkforceSelfServiceQueues(); await expect(h.query.mock.calls[0][0].queryFn({ signal: new AbortController().signal })).rejects.toThrow("Later queue page failed");
  });
  it("can wait for an authoritative facility scope", () => { useWorkforceSelfServiceQueues("foreign", { organizationId: "organization", enabled: false }); expect(h.query.mock.calls[0][0].enabled).toBe(false); });
});
