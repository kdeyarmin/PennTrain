import { beforeEach, describe, expect, it, vi } from "vitest";

type Request = { filters: unknown[][]; order: string[]; range: number[]; signal?: AbortSignal };
const h = vi.hoisted(() => ({ from: vi.fn(), query: vi.fn(), requests: [] as Request[], failAt: -1 }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListFacilities } from "./useFacilities";

const rows = ["first", "second", "last"].map(id => ({ id, name: "Same facility name" }));
function options(organizationId?: string, enabled = true) { useListFacilities({ organizationId }, enabled); return h.query.mock.calls.at(-1)![0]; }
beforeEach(() => {
  vi.clearAllMocks(); h.requests = []; h.failAt = -1;
  h.from.mockImplementation(() => {
    const request: Request = { filters: [], order: [], range: [] }; h.requests.push(request);
    const query = {
      select: () => query,
      eq: (...filter: unknown[]) => { request.filters.push(filter); return query; },
      order: (key: string) => { request.order.push(key); return query; },
      range: (from: number, to: number) => { request.range = [from, to]; return query; },
      abortSignal: (signal: AbortSignal) => { request.signal = signal; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(request.range[0], request.range[0] + 2), error: request.range[0] === h.failAt ? new Error("Later facility page unavailable") : null }).then(resolve),
    };
    return query;
  });
});

describe("complete facility choices", () => {
  it("keeps a current facility beyond a reduced response cap with scope and signal on every page", async () => {
    const signal = new AbortController().signal, lookup = options("organization");
    expect(lookup.queryKey).toEqual(["facilities", { organizationId: "organization" }]); expect(lookup.enabled).toBe(true);
    expect(await lookup.queryFn({ signal })).toEqual(rows);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [2, 1001], [3, 1002]]);
    for (const request of h.requests) { expect(request.filters).toEqual([["organization_id", "organization"]]); expect(request.order).toEqual(["name", "id"]); expect(request.signal).toBe(signal); }
  });
  it("rejects a later-page error instead of returning an incomplete facility list", async () => {
    h.failAt = 2;
    await expect(options("organization").queryFn({ signal: new AbortController().signal })).rejects.toThrow("Later facility page unavailable");
    expect(h.requests.map(request => request.range[0])).toEqual([0, 2]);
  });
  it("preserves the enabled gate and intentional all-organizations lookup", async () => {
    expect(options(undefined, false).enabled).toBe(false); expect(h.from).not.toHaveBeenCalled();
    expect(await options().queryFn({ signal: new AbortController().signal })).toEqual(rows);
    expect(h.requests.every(request => request.filters.length === 0)).toBe(true);
  });
});
