import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ client: null as unknown, rows: [] as Record<string, unknown>[], rpc: vi.fn(), reads: vi.fn() }));
vi.mock("@tanstack/react-query", async original => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => h.client,
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: () => {
  const query = { select: () => query, eq: () => query, order: async () => { h.reads(); return { data: [...h.rows], error: null }; } };
  return query;
} } }));
import { useMyShiftSwapRequests, useRequestShiftSwap } from "./useDailyOperations";

let client: QueryClient;
let unsubscribe: () => void;
beforeEach(() => { vi.clearAllMocks(); h.rows = []; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); h.client = client; });
afterEach(() => { unsubscribe?.(); client.clear(); });

describe("requesting a shift swap", () => {
  it("refreshes the mounted employee request list so the new request can be withdrawn", async () => {
    const options = useMyShiftSwapRequests("employee") as unknown as { queryKey: string[]; queryFn: () => Promise<Record<string, unknown>[]>; staleTime: number };
    await client.fetchQuery(options);
    const observer = new QueryObserver(client, options);
    unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toEqual([]);
    h.rpc.mockImplementation(async () => { h.rows.push({ id: "swap", status: "pending" }); return { data: "swap", error: null }; });
    const mutation = useRequestShiftSwap() as unknown as { mutationFn: (input: unknown) => Promise<string>; onSuccess: () => void };
    expect(await mutation.mutationFn({ requesterAssignmentId: "own-shift", targetAssignmentId: "other-shift", reason: "Appointment" })).toBe("swap");
    mutation.onSuccess();
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual([{ id: "swap", status: "pending" }]), { timeout: 200 });
    expect(h.rpc).toHaveBeenCalledWith("request_shift_swap", { p_requester_assignment_id: "own-shift", p_target_assignment_id: "other-shift", p_reason: "Appointment" });
    expect(h.reads).toHaveBeenCalledTimes(2);
  });
});
