import { describe, expect, it } from "vitest";
import { careDateTimeInstant, isCareCalendarDate } from "./careFormDates";

describe("editable care dates", () => {
  it.each(["", "not-a-date", "2026-02-30", "2026-13-01", "0000-01-01"])("rejects invalid date %j without rolling it forward", value => {
    expect(isCareCalendarDate(value)).toBe(false);
  });
  it("accepts real calendar days including leap day", () => {
    expect(isCareCalendarDate("2028-02-29")).toBe(true);
    expect(isCareCalendarDate("2026-09-26")).toBe(true);
  });
  it.each(["", "2026-02-30T09:00", "2026-09-26T24:00", "2026-09-26T09:99", "2026-03-08T02:30"])("refuses invalid/nonexistent appointment time %j", value => {
    expect(careDateTimeInstant(value)).toBeNull();
  });
  it("converts the selected Pennsylvania time without using the browser timezone", () => {
    expect(careDateTimeInstant("2026-09-26T09:30")).toBe("2026-09-26T13:30:00.000Z");
    expect(careDateTimeInstant("2026-01-26T09:30")).toBe("2026-01-26T14:30:00.000Z");
  });
});
