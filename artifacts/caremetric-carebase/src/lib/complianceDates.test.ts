import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { todayISO, addDaysISO, computeDueDate, computeStatus } from "./complianceDates";

// Pin "today" so due_soon/expired boundary assertions are deterministic regardless of when the
// test suite actually runs.
const FIXED_TODAY = "2026-06-15T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_TODAY));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("todayISO", () => {
  it("returns the current date as YYYY-MM-DD", () => {
    expect(todayISO()).toBe("2026-06-15");
  });
});

describe("addDaysISO", () => {
  it("adds days within a month", () => {
    expect(addDaysISO("2026-06-15", 10)).toBe("2026-06-25");
  });

  it("rolls over a month boundary", () => {
    expect(addDaysISO("2026-06-25", 10)).toBe("2026-07-05");
  });

  it("rolls over a year boundary", () => {
    expect(addDaysISO("2026-12-28", 10)).toBe("2027-01-07");
  });

  it("supports zero days (no-op)", () => {
    expect(addDaysISO("2026-06-15", 0)).toBe("2026-06-15");
  });
});

describe("computeDueDate", () => {
  it("returns null when there is no completion date", () => {
    expect(computeDueDate(null, 365)).toBeNull();
  });

  it("returns null for a one-time training with no renewal interval", () => {
    expect(computeDueDate("2026-01-01", null)).toBeNull();
    expect(computeDueDate("2026-01-01", undefined)).toBeNull();
  });

  it("adds the renewal interval to the completion date", () => {
    expect(computeDueDate("2026-01-01", 365)).toBe("2027-01-01");
  });
});

describe("computeStatus", () => {
  it("is missing when there is no completion date, regardless of due date", () => {
    expect(computeStatus(null, "2026-07-01", 90)).toBe("missing");
    expect(computeStatus(null, null, 90)).toBe("missing");
  });

  it("is compliant when completed with no due date (one-time training)", () => {
    expect(computeStatus("2026-01-01", null, 90)).toBe("compliant");
  });

  it("is expired when the due date is before today", () => {
    expect(computeStatus("2025-06-01", "2026-06-14", 90)).toBe("expired");
  });

  it("is due_soon when the due date falls exactly on the warning-window boundary", () => {
    // today (2026-06-15) + 90 days = 2026-09-13
    expect(computeStatus("2025-09-13", "2026-09-13", 90)).toBe("due_soon");
  });

  it("is compliant the day after the warning-window boundary", () => {
    expect(computeStatus("2025-09-14", "2026-09-14", 90)).toBe("compliant");
  });

  it("is expired the day before today (not due_soon)", () => {
    expect(computeStatus("2025-06-13", "2026-06-14", 90)).toBe("expired");
  });

  it("treats a due date of exactly today as due_soon, not expired", () => {
    expect(computeStatus("2025-06-15", "2026-06-15", 90)).toBe("due_soon");
  });
});
