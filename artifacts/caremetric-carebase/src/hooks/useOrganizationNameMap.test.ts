import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn(), read: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  from: (table: string) => {
    const request: { table: string; columns?: string; order?: unknown[]; ids?: string[]; range?: number[] } = { table };
    const query = {
      select: (columns: string) => { request.columns = columns; return query; },
      order: (...args: unknown[]) => { request.order = args; return query; },
      in: (column: string, ids: string[]) => {
        if (column !== "id") throw new Error("Names must be scoped by organization id");
        request.ids = ids;
        return query;
      },
      range: (from: number, to: number) => {
        request.range = [from, to];
        return mocks.read(request);
      },
    };
    return query;
  },
} }));

import { useOrganizationNameMap } from "./useAdminNotificationDeliveries";

type Organization = { id: string; name: string };
type Options = { queryKey: unknown[]; queryFn: () => Promise<Record<string, string>>; enabled: boolean };
type Request = { table: string; columns: string; order: unknown[]; ids?: string[]; range: [number, number] };

function options(ids?: string[]): Options {
  useOrganizationNameMap(ids);
  return mocks.useQuery.mock.calls.at(-1)![0] as Options;
}

function respondWith(rows: Organization[], cap = 1000) {
  mocks.read.mockImplementation(async (request: Request) => {
    const visible = rows.filter(row => request.ids === undefined || request.ids.includes(row.id)).sort((a, b) => a.id.localeCompare(b.id));
    const [from, to] = request.range;
    return { data: visible.slice(from, Math.min(to + 1, from + cap)), error: null };
  });
}

beforeEach(() => { vi.clearAllMocks(); mocks.read.mockReset(); });

describe("organization name lookups", () => {
  it("keeps the unrestricted cache key and retrieves names beyond a lower API cap", async () => {
    respondWith([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }], 2);
    const query = options();
    expect(query.queryKey).toEqual(["organizations", "name_map"]);
    expect(query.enabled).toBe(true);
    await expect(query.queryFn()).resolves.toEqual({ a: "Alpha", b: "Beta", c: "Gamma" });
    expect(mocks.read.mock.calls.map(([request]) => request.range[0])).toEqual([0, 2, 3]);
    for (const [request] of mocks.read.mock.calls) {
      expect(request).toMatchObject({ table: "organizations", columns: "id, name", order: ["id", { ascending: true }] });
      expect(request.ids).toBeUndefined();
    }
  });

  it("requests only unique visible ids and shares a stable cache across row ordering", async () => {
    respondWith([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "other", name: "Unrequested" }]);
    const query = options(["b", "a", "b", ""]);
    expect(query.queryKey).toEqual(options(["a", "b"]).queryKey);
    expect(query.queryKey).toEqual(["organizations", "name_map", ["a", "b"]]);
    await expect(query.queryFn()).resolves.toEqual({ a: "Alpha", b: "Beta" });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read.mock.calls[0][0].ids).toEqual(["a", "b"]);
  });

  it("continues capped scoped responses until exhausted, allowing inaccessible ids", async () => {
    respondWith([{ id: "a", name: "Alpha" }, { id: "c", name: "Gamma" }], 1);
    await expect(options(["a", "b", "c"]).queryFn()).resolves.toEqual({ a: "Alpha", c: "Gamma" });
    expect(mocks.read.mock.calls.map(([request]) => request.range[0])).toEqual([0, 1, 2]);
    expect(mocks.read.mock.calls.every(([request]) => request.ids.join(",") === "a,b,c")).toBe(true);
  });

  it("splits large id sets into bounded requests without losing their tail", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ id: `org-${String(index).padStart(3, "0")}`, name: `Organization ${index}` }));
    respondWith(rows);
    const map = await options(rows.map(row => row.id)).queryFn();
    expect(Object.keys(map)).toHaveLength(205);
    expect(map["org-204"]).toBe("Organization 204");
    expect(mocks.read.mock.calls.map(([request]) => request.ids.length)).toEqual([100, 100, 5]);
  });

  it("disables an explicit empty scope and never turns manual refetch into a full lookup", async () => {
    const query = options([]);
    expect(query.enabled).toBe(false);
    expect(query.queryKey).toEqual(["organizations", "name_map", []]);
    await expect(query.queryFn()).resolves.toEqual({});
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns an empty successful map when no visible organizations exist", async () => {
    respondWith([]);
    await expect(options().queryFn()).resolves.toEqual({});
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("rejects a later page failure instead of caching a partial map, and supports retry", async () => {
    const error = { message: "Organization lookup unavailable", code: "503" };
    mocks.read.mockResolvedValueOnce({ data: [{ id: "a", name: "Alpha" }], error: null })
      .mockResolvedValueOnce({ data: null, error });
    const query = options(["a", "b"]);
    await expect(query.queryFn()).rejects.toBe(error);
    respondWith([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]);
    await expect(query.queryFn()).resolves.toEqual({ a: "Alpha", b: "Beta" });
  });
});
