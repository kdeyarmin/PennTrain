import { describe, expect, it } from "vitest";
import { buildSavedViewFilters, parseSavedViewFilters, reportCategoryToDomain } from "./savedReportViews";

describe("saved report views", () => {
  it("round-trips a full view configuration", () => {
    const filters = buildSavedViewFilters({
      reportId: "expired-training",
      facilityId: "f-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
    });
    expect(parseSavedViewFilters(filters)).toEqual({
      reportId: "expired-training",
      facilityId: "f-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
    });
  });

  it("omits the all-facilities default and empty dates", () => {
    expect(buildSavedViewFilters({ reportId: "due-soon", facilityId: "all" })).toEqual({ reportId: "due-soon" });
  });

  it("rejects malformed stored filters instead of throwing", () => {
    expect(parseSavedViewFilters(null)).toBeNull();
    expect(parseSavedViewFilters("nope")).toBeNull();
    expect(parseSavedViewFilters({ facilityId: "f-1" })).toBeNull();
    expect(parseSavedViewFilters({ reportId: 42 })).toBeNull();
  });

  it("maps card categories onto the schema report_type domains", () => {
    expect(reportCategoryToDomain("Credentials")).toBe("qualification");
    expect(reportCategoryToDomain("Incidents")).toBe("incident");
    expect(reportCategoryToDomain("Training")).toBe("compliance");
    expect(reportCategoryToDomain("Anything else")).toBe("compliance");
  });
});
