import { describe, expect, it } from "vitest";
import { sanitizeVideoState } from "./videoWatchState";

describe("sanitizeVideoState", () => {
  it("passes through well-formed entries", () => {
    expect(sanitizeVideoState({
      "block-1": { position: 12.5, maxWatched: 40, completedAt: "2026-07-12T00:00:00Z" },
    })).toEqual({
      "block-1": { position: 12.5, maxWatched: 40, completedAt: "2026-07-12T00:00:00Z" },
    });
  });

  it("degrades malformed values to not-watched instead of throwing", () => {
    expect(sanitizeVideoState(null)).toEqual({});
    expect(sanitizeVideoState("nonsense")).toEqual({});
    expect(sanitizeVideoState([1, 2])).toEqual({});
    expect(sanitizeVideoState({ "block-1": "nope", "block-2": null })).toEqual({});
    expect(sanitizeVideoState({
      "block-1": { position: -5, maxWatched: "far", completedAt: 42 },
    })).toEqual({
      "block-1": { position: 0, maxWatched: 0, completedAt: null },
    });
  });

  it("keeps the high-water mark at least at the resume position", () => {
    expect(sanitizeVideoState({
      "block-1": { position: 30, maxWatched: 10, completedAt: null },
    })).toEqual({
      "block-1": { position: 30, maxWatched: 30, completedAt: null },
    });
  });
});
