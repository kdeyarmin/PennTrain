import { beforeEach, describe, expect, it, vi } from "vitest";

type Request = { ids: string[]; order: string[]; range: number[]; signal?: AbortSignal };
const h = vi.hoisted(() => ({ from: vi.fn(), query: vi.fn(), requests: [] as Request[], failAt: -1, cap: 2 }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListEmployeesByIds } from "./useEmployees";

function options(ids: string[]) { useListEmployeesByIds(ids); return h.query.mock.calls.at(-1)![0]; }
const row = (id: string) => ({ id, last_name: "Same surname", status: "inactive" });
beforeEach(() => {
  vi.clearAllMocks(); h.requests = []; h.failAt = -1; h.cap = 2;
  h.from.mockImplementation(() => {
    const request: Request = { ids: [], order: [], range: [0, 199] }; h.requests.push(request);
    const query = {
      select: () => query,
      in: (key: string, ids: string[]) => { expect(key).toBe("id"); request.ids = ids; return query; },
      order: (key: string) => { request.order.push(key); return query; },
      range: (from: number, to: number) => { request.range = [from, to]; return query; },
      abortSignal: (signal: AbortSignal) => { request.signal = signal; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: request.ids.slice(request.range[0], request.range[0] + h.cap).map(row), error: request.range[0] === h.failAt ? new Error("Later employee page unavailable") : request.signal?.aborted ? new Error("Lookup aborted") : null }).then(resolve),
    };
    return query;
  });
});

describe("complete employee identity lookups", () => {
  it("reads every authorized candidate through the empty page under a reduced response cap", async () => {
    const signal = new AbortController().signal, lookup = options(["c", "a", "b", "a", ""]);
    expect(lookup.queryKey).toEqual(["employees", "by-ids", ["a", "b", "c"]]);
    expect(await lookup.queryFn({ signal })).toEqual(["a", "b", "c"].map(row));
    expect(h.requests.map(request => request.range)).toEqual([[0, 199], [2, 201], [3, 202]]);
    for (const request of h.requests) { expect(request.ids).toEqual(["a", "b", "c"]); expect(request.order).toEqual(["last_name", "id"]); expect(request.signal).toBe(signal); }
  });
  it("keeps 200-ID URL chunks while independently paging each chunk", async () => {
    h.cap = 99;
    const ids = Array.from({ length: 201 }, (_, index) => `employee-${String(index).padStart(3, "0")}`);
    expect(await options(ids).queryFn({ signal: new AbortController().signal })).toEqual(ids.map(row));
    expect(h.requests.map(request => [request.ids.length, request.range[0]])).toEqual([[200, 0], [200, 99], [200, 198], [200, 200], [1, 0], [1, 1]]);
    expect(h.requests.slice(0, 4).every(request => request.ids.join() === ids.slice(0, 200).join())).toBe(true);
    expect(h.requests[4].ids).toEqual([ids[200]]);
  });
  it("rejects partial candidate identities when a later page fails", async () => {
    h.failAt = 2;
    await expect(options(["a", "b", "c"]).queryFn({ signal: new AbortController().signal })).rejects.toThrow("Later employee page unavailable");
    expect(h.requests.map(request => request.range[0])).toEqual([0, 2]);
  });
  it("passes cancellation to the lookup and never starts an empty-ID request", async () => {
    const empty = options([]); expect(empty.enabled).toBe(false); expect(await empty.queryFn({ signal: new AbortController().signal })).toEqual([]); expect(h.from).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(options(["a"]).queryFn({ signal: controller.signal })).rejects.toThrow("Lookup aborted");
    expect(h.requests[0].signal).toBe(controller.signal);
  });
});
