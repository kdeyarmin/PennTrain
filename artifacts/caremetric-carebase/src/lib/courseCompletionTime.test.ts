import { describe, expect, it } from "vitest";
import { courseCompletionWaitSeconds, designedEngagementMinutes } from "./courseCompletionTime";

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
  it("keeps a comprehensive course open for the full designed time, not ten percent", () => {
    expect(courseCompletionWaitSeconds(started, 30, now, { contentStandard: "comprehensive", designedMinutes: 30 })).toBe(1800);
    expect(courseCompletionWaitSeconds(started, 30, now + 180_000, { contentStandard: "comprehensive", designedMinutes: 30 })).toBe(1620);
    expect(courseCompletionWaitSeconds(started, 30, now + 1_800_000, { contentStandard: "comprehensive", designedMinutes: 30 })).toBe(0);
    expect(courseCompletionWaitSeconds(started, 30, now, { contentStandard: "legacy", designedMinutes: 30 })).toBe(180);
    expect(courseCompletionWaitSeconds(started, 240, now, { contentStandard: "comprehensive", designedMinutes: 60 })).toBe(3600);
    expect(courseCompletionWaitSeconds(started, 480, now, { contentStandard: "comprehensive", designedMinutes: 30 })).toBe(2880);
  });
});

describe("designed engagement minutes", () => {
  it("sums only the 1 to 120 minute values the database accepts", () => {
    expect(designedEngagementMinutes([
      { body: { estimated_minutes: 10 } },
      { body: { estimated_minutes: "20" } },
      { body: { estimated_minutes: 0 } },
      { body: { estimated_minutes: "121" } },
      { body: {} },
    ])).toBe(30);
  });
});
