import { describe, expect, it } from "vitest";
import { latestQueryUpdatedAt, formatTimestampLabel } from "./freshness";

describe("freshness helpers", () => {
  it("picks the newest successful query timestamp", () => {
    expect(latestQueryUpdatedAt([100, undefined, 250, 0])).toBe(250);
  });

  it("returns undefined when no query has refreshed", () => {
    expect(latestQueryUpdatedAt([undefined, 0, Number.NaN])).toBeUndefined();
  });

  it("formats missing timestamps with a stable fallback", () => {
    expect(formatTimestampLabel(undefined)).toBe("Not refreshed yet");
  });
});
