import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), query: vi.fn(), mutation: vi.fn(), rpc: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: h.mutation, useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
import { useHrisImportRows, useHrisImportRuns, useHrisSourceSystems, useSetHrisImportRowDecision, useCreateHrisSourceSystem } from "./useHrisImportRuns";
beforeEach(() => vi.clearAllMocks());
const kinds = ["sources", "runs", "rows"] as const;
function read(kind: typeof kinds[number]) { if (kind === "sources") useHrisSourceSystems("organization"); else if (kind === "runs") useHrisImportRuns("organization"); else useHrisImportRows("run"); return h.query.mock.calls.at(-1)![0]; }
function setup(failedPage?: number) {
  const calls: Array<{ table: string; filters: unknown[]; order: string[]; from: number; signal?: AbortSignal }> = [];
  h.from.mockImplementation((table: string) => {
    const call = { table, filters: [] as unknown[], order: [] as string[], from: 0, signal: undefined as AbortSignal | undefined }; calls.push(call);
    const q = { select: () => q, eq: (key: string, value: string) => { call.filters.push([key, value]); return q; }, in: (key: string, value: string[]) => { call.filters.push([key, value]); return q; }, order: (key: string) => { call.order.push(key); return q; }, limit: () => q, range: (from: number) => { call.from = from; return q; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: Array.from({ length: 25 }, (_, id) => ({ id })).slice(call.from, call.from + 7), error: call.from === failedPage ? new Error("Later page unavailable") : null })) };
    return q;
  }); return calls;
}
describe("complete scoped HRIS collections", () => {
  it.each(kinds)("keeps all %s accessible under a lower server response cap", async kind => {
    const calls = setup(), signal = new AbortController().signal, options = read(kind);
    expect(await options.queryFn({ signal })).toHaveLength(25);
    expect(calls.map(call => call.from)).toEqual([0, 7, 14, 21, 25]);
    for (const call of calls) {
      expect(call.signal).toBe(signal);
      expect(call.filters).toContainEqual([kind === "rows" ? "import_run_id" : "organization_id", kind === "rows" ? "run" : "organization"]);
      expect(call.order.at(-1)).toBe("id");
      if (kind === "sources") expect(call.filters).toContainEqual(["status", ["pilot", "active"]]);
    }
    expect(options.queryKey).toContain(kind === "rows" ? "run" : "organization");
  });
  it.each(kinds)("does not return partial %s after a later-page failure", async kind => {
    setup(14); await expect(read(kind).queryFn({ signal: new AbortController().signal })).rejects.toThrow("Later page unavailable");
  });
  it("refreshes uncertain decision receipts and waits for both row and run state before settling", async () => {
    useSetHrisImportRowDecision("run-A"); const options = h.mutation.mock.calls[0][0];
    let release!: () => void; h.invalidate.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    let settled = false; const pending = options.onSettled().then(() => { settled = true; });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["hris-import-rows", "run-A"] });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["qualified-workforce", "hris"] });
    await Promise.resolve(); expect(settled).toBe(false); release(); await pending; expect(settled).toBe(true);
  });
  it("refreshes the source picker after an uncertain registration so a committed source remains discoverable", async () => {
    h.invalidate.mockResolvedValue(undefined); useCreateHrisSourceSystem(); await h.mutation.mock.calls[0][0].onSettled();
    expect(h.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ["qualified-workforce", "hris"] });
  });
});
