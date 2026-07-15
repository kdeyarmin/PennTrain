import { describe, expect, it } from "vitest";
import { getTimeOffRequestWindowError, normalizeTimeOffRequestWindow } from "./timeOffRequest";

describe("normalizeTimeOffRequestWindow", () => {
  it("normalizes a valid local datetime window to ISO timestamps", () => {
    const result = normalizeTimeOffRequestWindow("2026-07-15T09:00", "2026-07-15T17:30");

    expect(result.startsAtIso).toBe(new Date("2026-07-15T09:00").toISOString());
    expect(result.endsAtIso).toBe(new Date("2026-07-15T17:30").toISOString());
  });

  it("allows incomplete draft windows while the user is filling out the dialog", () => {
    expect(getTimeOffRequestWindowError("", "")).toBeNull();
    expect(getTimeOffRequestWindowError("2026-07-15T09:00", "")).toBeNull();
  });

  it("rejects invalid date input before attempting ISO conversion", () => {
    expect(() => normalizeTimeOffRequestWindow("not-a-date", "2026-07-15T17:30")).toThrow(
      "Enter a valid start and end date/time for the time-off request."
    );
  });

  it("rejects zero-length or backwards request windows", () => {
    expect(() => normalizeTimeOffRequestWindow("2026-07-15T17:30", "2026-07-15T17:30")).toThrow(
      "The time-off end must be after the start."
    );
    expect(() => normalizeTimeOffRequestWindow("2026-07-15T17:30", "2026-07-15T09:00")).toThrow(
      "The time-off end must be after the start."
    );
  });
});
