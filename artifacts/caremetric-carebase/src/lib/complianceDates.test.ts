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

describe("computeStatus holds a certificate that is still awaiting review", () => {
  // `pending_review` carries two meanings on this table and `approval_status` separates them:
  // a certificate the Pending Approvals queue is holding (`'pending'`), and an auto-instantiated
  // audience shell (null) whose whole purpose is to be confirmed by recording training against it.

  it("preserves a certificate the approval queue is holding", () => {
    // The defect this covers, measured on a live stack: writing `compliant` over that status makes
    // the record's hours count toward the annual bucket -- `legacy_earned` joins
    // `r.status not in ('pending_review','not_applicable')` -- while `approval_status` is still
    // `pending` and `verified_at` still null. An unreviewed certificate credited as training.
    expect(computeStatus("2026-06-01", "2027-06-01", 90, "pending_review", "pending"))
      .toBe("pending_review");
    expect(computeStatus("2020-01-01", "2021-01-01", 90, "pending_review", "pending"))
      .toBe("pending_review");
  });

  it("lets an audience shell graduate, because recording training IS the confirmation", () => {
    // `training_types.audience_verification_required`'s own column comment: the requirement
    // "remains pending_review and is excluded from annual-hour rollups until an employer confirms
    // this exact audience by changing the record to an active requirement status". Preserving the
    // status here would save the completion and the hours while the recalc went on excluding them.
    expect(computeStatus("2026-06-01", "2027-06-01", 90, "pending_review", null)).toBe("compliant");
    expect(computeStatus("2026-06-01", "2027-06-01", 90, "pending_review", undefined)).toBe("compliant");
  });

  it("lets not_applicable graduate too -- it is the same audience decision, seen from the other side", () => {
    // `audience_decision_at` is stamped "when the audience decision category changes among
    // pending_review, not_applicable, and applicable", so both are changed by the same route. A
    // manager recording a completion against one is asserting the requirement does apply.
    expect(computeStatus("2026-06-01", "2027-06-01", 90, "not_applicable", null)).toBe("compliant");
  });

  it("recomputes every other status from the dates, unchanged", () => {
    for (const carried of ["missing", "compliant", "due_soon", "expired", "", null, undefined]) {
      expect(computeStatus("2025-06-01", "2026-06-14", 90, carried, "pending"), String(carried))
        .toBe("expired");
    }
  });

  it("still recomputes when nothing is passed, which is how an approval is expressed", () => {
    // PendingApprovals omits both arguments on purpose: moving a record out of pending_review is
    // what approving it means, and the recalc would never do that on its own.
    expect(computeStatus("2026-06-01", "2027-06-01", 90)).toBe("compliant");
  });
});
