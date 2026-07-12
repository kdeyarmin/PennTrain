import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysUntil, formatDateForDisplay, formatDueDistance, toLocalIsoDate } from "./dateUtils";

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

describe("daysUntil", () => {
  const today = new Date(2026, 6, 12, 9, 30); // Jul 12, 2026, local

  it("counts whole local calendar days for bare dates", () => {
    expect(daysUntil("2026-07-12", today)).toBe(0);
    expect(daysUntil("2026-07-15", today)).toBe(3);
    expect(daysUntil("2026-07-10", today)).toBe(-2);
  });

  it("flips at local midnight, not 24 hours after the current instant", () => {
    const lateEvening = new Date(2026, 6, 11, 23, 59);
    expect(daysUntil("2026-07-12", lateEvening)).toBe(1);
  });

  it("counts timestamps by their local calendar day", () => {
    const sameDay = new Date(2026, 6, 12, 1, 0);
    expect(daysUntil(new Date(2026, 6, 12, 23, 0).toISOString(), sameDay)).toBe(0);
  });

  it("handles missing and invalid values", () => {
    expect(daysUntil(null, today)).toBeNull();
    expect(daysUntil("not-a-date", today)).toBeNull();
  });
});

describe("formatDueDistance", () => {
  const today = new Date(2026, 6, 12, 9, 30);

  it("phrases future, today, and overdue distances", () => {
    expect(formatDueDistance("2026-07-12", today)).toBe("today");
    expect(formatDueDistance("2026-07-13", today)).toBe("tomorrow");
    expect(formatDueDistance("2026-07-19", today)).toBe("in 7 days");
    expect(formatDueDistance("2026-07-11", today)).toBe("1 day overdue");
    expect(formatDueDistance("2026-07-05", today)).toBe("7 days overdue");
  });

  it("returns null when there is no usable date", () => {
    expect(formatDueDistance(null, today)).toBeNull();
    expect(formatDueDistance("not-a-date", today)).toBeNull();
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
