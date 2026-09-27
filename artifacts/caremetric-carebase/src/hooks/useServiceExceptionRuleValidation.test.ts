import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), mutation: null as { mutationFn: (input: unknown) => Promise<unknown> } | null }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: (options: typeof h.mutation) => { h.mutation = options; return {}; } }));
import { useUpsertServiceExceptionRule } from "./useResidentServiceTasks";
const base = { facilityId: "facility", exceptionStatus: "resident_refused", thresholdCount: 2, lookbackDays: 7, actionTarget: "supervisor", isActive: true };
beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: "rule", error: null }); useUpsertServiceExceptionRule(); });
it.each([
  { thresholdCount: 0 }, { thresholdCount: 101 }, { thresholdCount: 1.5 }, { thresholdCount: NaN },
  { lookbackDays: 0 }, { lookbackDays: 91 }, { lookbackDays: 2.5 }, { lookbackDays: Infinity },
])("rejects invalid rule values before an RPC: %j", async override => {
  await expect(h.mutation!.mutationFn({ ...base, ...override })).rejects.toThrow(/whole number/);
  expect(h.rpc).not.toHaveBeenCalled();
});
it("retains valid boundary values and facility scope", async () => {
  await h.mutation!.mutationFn({ ...base, thresholdCount: 100, lookbackDays: 90 });
  expect(h.rpc).toHaveBeenCalledWith("upsert_service_exception_rule", expect.objectContaining({ p_facility_id: "facility", p_threshold_count: 100, p_lookback_days: 90 }));
});
