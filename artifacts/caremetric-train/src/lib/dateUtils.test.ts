import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateForDisplay, toLocalIsoDate } from "./dateUtils";

describe("toLocalIsoDate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the local calendar day instead of the UTC day", () => {
    vi.setSystemTime(new Date(2026, 6, 10, 23, 30));
    expect(toLocalIsoDate()).toBe("2026-07-10");
  });

  it("pads single-digit months and days", () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("formatDateForDisplay", () => {
  it("preserves a bare calendar date", () => {
    expect(formatDateForDisplay("2026-01-05", { timeZone: "America/New_York" })).toBe("1/5/2026");
  });

  it("formats timestamps as instants", () => {
    expect(formatDateForDisplay("2026-01-05T02:00:00Z", { timeZone: "America/New_York" })).toBe("1/4/2026");
  });

  it("handles missing and invalid values", () => {
    expect(formatDateForDisplay(null)).toBe("—");
    expect(formatDateForDisplay("not-a-date")).toBe("—");
  });
});
