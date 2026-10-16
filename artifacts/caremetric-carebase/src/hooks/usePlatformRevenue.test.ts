import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { readAllByIds, readAllPages } from "./usePlatformRevenue";

const rows = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ n: start + i }));

describe("revenue paging", () => {
  it("keeps reading past the server's row cap and advances by the rows returned", async () => {
    const calls: Array<[number, number]> = [];
    // A server that caps at 600 rows even though 1,000 were asked for.
    const result = await readAllPages(async (from, to) => {
      calls.push([from, to]);
      const remaining = Math.max(0, 1500 - from);
      return { data: rows(from, Math.min(600, remaining)), error: null };
    });
    expect(result).toHaveLength(1500);
    expect(result.map((row) => row.n)).toEqual(rows(0, 1500).map((row) => row.n));
    expect(calls).toEqual([[0, 999], [600, 1599], [1200, 2199], [1500, 2499]]);
  });

  it("throws on a failed page instead of returning partial totals", async () => {
    let page = 0;
    await expect(readAllPages(async () => {
      page += 1;
      return page === 1
        ? { data: rows(0, 1000), error: null }
        : { data: null, error: { message: "timeout", details: "", hint: "", code: "57014", name: "PostgrestError" } };
    })).rejects.toMatchObject({ code: "57014" });
  });

  it("splits id filters into bounded batches and drops duplicates", async () => {
    const ids = [...Array.from({ length: 250 }, (_, i) => `id-${i}`), "id-0", "id-1"];
    const batches: number[] = [];
    const result = await readAllByIds(ids, async (batch, from) => {
      if (from === 0) batches.push(batch.length);
      return { data: from === 0 ? batch.map((id) => ({ id })) : [], error: null };
    });
    expect(batches).toEqual([100, 100, 50]);
    expect(result).toHaveLength(250);
  });

  it("makes no request when there are no ids", async () => {
    const page = vi.fn();
    expect(await readAllByIds([], page)).toEqual([]);
    expect(page).not.toHaveBeenCalled();
  });
});
