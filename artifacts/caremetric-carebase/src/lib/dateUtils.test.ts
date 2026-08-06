import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysUntil,
  facilityDateRangeBounds,
  facilityDateTimeToUtc,
  facilityDayBounds,
  facilityDaysUntil,
  addFacilityCalendarDays,
  facilityToday,
  formatDateForDisplay,
  formatDueDistance,
  toLocalIsoDate,
} from "./dateUtils";

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

describe("facilityToday", () => {
  // The clock is passed in rather than faked, so these assert on fixed instants. They are written
  // as UTC instants deliberately: the point of the function is that its answer does NOT depend on
  // where the browser thinks it is, and the test would be circular if it built dates the same way
  // the implementation reads them.

  it("is still yesterday's date in Pennsylvania once UTC has rolled over", () => {
    // 2026-07-27T00:56Z is 2026-07-26 20:56 EDT -- the hour the underlying bug was found in.
    expect(facilityToday(new Date("2026-07-27T00:56:00Z"))).toBe("2026-07-26");
    expect(facilityToday(new Date("2026-07-27T03:59:00Z"))).toBe("2026-07-26");
    expect(facilityToday(new Date("2026-07-27T04:01:00Z"))).toBe("2026-07-27");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // EST is UTC-5, so 04:59Z in January is still the previous day...
    expect(facilityToday(new Date("2026-01-15T04:59:00Z"))).toBe("2026-01-14");
    // ...while EDT is UTC-4, so the same 04:59Z in July is already the new one.
    expect(facilityToday(new Date("2026-07-15T04:59:00Z"))).toBe("2026-07-15");
  });

  it("disagrees with the browser's local day when the browser is not in Pennsylvania", () => {
    // This is the case that broke the resident lifecycle journey: a UTC browser at 20:56 ET offered
    // tomorrow as the default participation date and the server rejected it.
    const evening = new Date("2026-07-27T00:56:00Z");
    const inUtcBrowser = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(evening);
    expect(inUtcBrowser).toBe("2026-07-27");
    expect(facilityToday(evening)).toBe("2026-07-26");
  });

  it("zero-pads so the result compares and sorts as a date string", () => {
    expect(facilityToday(new Date("2026-03-05T17:00:00Z"))).toBe("2026-03-05");
    expect(facilityToday(new Date("2026-11-09T17:00:00Z"))).toBe("2026-11-09");
  });
});

describe("addFacilityCalendarDays", () => {
  it("adds and subtracts whole calendar days across month boundaries", () => {
    expect(addFacilityCalendarDays("2026-01-20", 15)).toBe("2026-02-04");
    expect(addFacilityCalendarDays("2026-03-01", -30)).toBe("2026-01-30");
    expect(addFacilityCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("facilityDayBounds", () => {
  it("covers a full EDT calendar day as a half-open UTC range", () => {
    // 2026-07-15 is EDT (UTC-4): midnight local = 04:00Z, next midnight = 04:00Z next day.
    const bounds = facilityDayBounds("2026-07-15");
    expect(bounds.from).toBe("2026-07-15T04:00:00.000Z");
    expect(bounds.through).toBe("2026-07-16T04:00:00.000Z");
  });

  it("covers a full EST calendar day as a half-open UTC range", () => {
    // 2026-01-15 is EST (UTC-5): midnight local = 05:00Z.
    const bounds = facilityDayBounds("2026-01-15");
    expect(bounds.from).toBe("2026-01-15T05:00:00.000Z");
    expect(bounds.through).toBe("2026-01-16T05:00:00.000Z");
  });

  it("facilityDateTimeToUtc lands on Eastern midnight for the given day", () => {
    expect(facilityDateTimeToUtc("2026-07-15", "00:00:00").toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(facilityDateTimeToUtc("2026-01-15", "00:00:00").toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("facilityDateRangeBounds includes the full through day", () => {
    const range = facilityDateRangeBounds("2026-07-10", "2026-07-12");
    expect(range.from).toBe("2026-07-10T04:00:00.000Z");
    expect(range.through).toBe("2026-07-13T04:00:00.000Z");
  });
});

describe("facilityDaysUntil", () => {
  it("counts facility calendar days independent of browser timezone", () => {
    // 2026-07-25T12:00Z is still 2026-07-25 in Pennsylvania (EDT).
    const now = new Date("2026-07-25T12:00:00Z");
    expect(facilityDaysUntil("2026-07-25", now)).toBe(0);
    expect(facilityDaysUntil("2026-07-28", now)).toBe(3);
    expect(facilityDaysUntil("2026-07-24", now)).toBe(-1);
  });

  it("handles missing and non-date values", () => {
    expect(facilityDaysUntil(null)).toBeNull();
    expect(facilityDaysUntil("not-a-date")).toBeNull();
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
