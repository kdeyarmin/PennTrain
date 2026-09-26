import { describe, expect, it } from "vitest";
import { courseCompletionWaitSeconds } from "./courseCompletionTime";

describe("course completion pacing", () => {
  const started = "2026-09-25T12:00:00Z";
  const now = Date.parse(started);
  it("waits for recorded progress instead of offering premature completion", () => {
    expect(courseCompletionWaitSeconds(null, 5, now)).toBeNull();
    expect(courseCompletionWaitSeconds("invalid", 5, now)).toBeNull();
  });
  it("honors the full one-minute floor, including the final fractional second", () => {
    expect(courseCompletionWaitSeconds(started, null, now)).toBe(60);
    expect(courseCompletionWaitSeconds(started, 5, now + 59_999)).toBe(1);
    expect(courseCompletionWaitSeconds(started, 5, now + 60_000)).toBe(0);
  });
  it("uses ten percent of catalog duration for longer courses and preserves resumed time", () => {
    expect(courseCompletionWaitSeconds(started, 120, now + 60_000)).toBe(660);
    expect(courseCompletionWaitSeconds(started, 120, now + 720_000)).toBe(0);
    expect(courseCompletionWaitSeconds(started, 120, now + 900_000)).toBe(0);
  });
});
