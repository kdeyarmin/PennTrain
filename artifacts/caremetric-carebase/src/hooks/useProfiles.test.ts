import { describe, expect, it, vi } from "vitest";

// The module imports Supabase at module scope; these helpers take their fetcher by argument.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { fetchProfileNameMap, profileNameCacheIds, profileNameIdChunks } from "./useProfiles";

const uuid = (n: number) => `${String(n).padStart(8, "0")}-1c36-4fe4-b03b-6b8879f138a8`;

describe("profileNameIdChunks", () => {
  it("bounds every request so a large id set cannot build a URL the gateway rejects", () => {
    // useListSupportTickets pages until exhausted and SupportTickets renders every row, so this
    // id list has no upper bound from the caller. A single .in() over 5,000 uuids is ~195 KB of
    // request line; a gateway answers 414 and, because no caller surfaces this query's error,
    // every requester renders as "Unknown" -- the symptom the id-scoping was added to remove.
    const chunks = profileNameIdChunks(Array.from({ length: 5000 }, (_, i) => uuid(i)));
    expect(chunks.length).toBe(50);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    // A uuid plus its separator is 39 bytes on the wire; keep each request well under ~8 KB.
    for (const chunk of chunks) expect(chunk.length * 39).toBeLessThan(8000);
  });

  it("covers every distinct id exactly once", () => {
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i));
    const flat = profileNameIdChunks(ids).flat();
    expect(flat.length).toBe(250);
    expect(new Set(flat).size).toBe(250);
    expect([...flat].sort()).toEqual([...ids].sort());
  });

  it("de-duplicates and drops blanks rather than spending request budget on them", () => {
    expect(profileNameIdChunks([uuid(1), uuid(1), "", uuid(2)])).toEqual([[uuid(1), uuid(2)]]);
  });

  it("returns no chunks for an empty set, so the hook issues no request", () => {
    expect(profileNameIdChunks([])).toEqual([]);
  });
});

describe("profileNameCacheIds", () => {
  it("sorts so two callers with the same actors in a different order share one cache entry", () => {
    expect(profileNameCacheIds([uuid(2), uuid(1)])).toEqual(profileNameCacheIds([uuid(1), uuid(2)]));
  });
});

describe("fetchProfileNameMap", () => {
  it("merges every chunk, so a name past the first batch is not lost", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i));
    const seen: string[][] = [];
    const map = await fetchProfileNameMap(ids, async (chunk) => {
      seen.push(chunk);
      return chunk.map((id) => ({ id, first_name: "Dana", last_name: `R${id.slice(0, 8)}` }));
    });
    expect(seen.length).toBe(3);
    expect(Object.keys(map).length).toBe(250);
    // The last id lands in the third request; an unchunked implementation that truncated would miss it.
    const last = [...ids].sort().at(-1)!;
    expect(map[last]).toBe(`Dana R${last.slice(0, 8)}`);
  });

  it("issues no request at all when there is nothing to resolve", async () => {
    const fetchChunk = vi.fn();
    expect(await fetchProfileNameMap([], fetchChunk)).toEqual({});
    expect(fetchChunk).not.toHaveBeenCalled();
  });

  it("trims a missing surname instead of rendering a trailing space", async () => {
    const map = await fetchProfileNameMap([uuid(1)], async (chunk) =>
      chunk.map((id) => ({ id, first_name: "Dana", last_name: null })),
    );
    expect(map[uuid(1)]).toBe("Dana");
  });

  it("propagates a failed chunk rather than returning a half-built map", async () => {
    await expect(
      fetchProfileNameMap([uuid(1)], async () => {
        throw new Error("414 URI Too Long");
      }),
    ).rejects.toThrow("414");
  });
});
