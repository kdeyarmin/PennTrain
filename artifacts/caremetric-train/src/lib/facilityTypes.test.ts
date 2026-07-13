import { describe, it, expect } from "vitest";
import { facilityTypeLabel, hasAnyFacilityType, PCH_ALR_ONLY_FACILITY_TYPES } from "./facilityTypes";

describe("hasAnyFacilityType", () => {
  it("is false while facilityTypes is undefined (still loading, or role not applicable)", () => {
    expect(hasAnyFacilityType(undefined, PCH_ALR_ONLY_FACILITY_TYPES)).toBe(false);
  });

  it("is false when none of the candidates are present", () => {
    expect(hasAnyFacilityType(new Set(["NH", "HHA", "HOS", "GH"]), PCH_ALR_ONLY_FACILITY_TYPES)).toBe(false);
  });

  it("is true when at least one candidate is present", () => {
    expect(hasAnyFacilityType(new Set(["NH", "PCH"]), PCH_ALR_ONLY_FACILITY_TYPES)).toBe(true);
    expect(hasAnyFacilityType(new Set(["ALR"]), PCH_ALR_ONLY_FACILITY_TYPES)).toBe(true);
  });

  it("is false for an empty set", () => {
    expect(hasAnyFacilityType(new Set(), PCH_ALR_ONLY_FACILITY_TYPES)).toBe(false);
  });
});

describe("facilityTypeLabel", () => {
  it("maps stored facility codes to customer-facing labels", () => {
    expect(facilityTypeLabel("ALR")).toBe("Assisted Living Facility (ALF)");
    expect(facilityTypeLabel("NH")).toBe("Skilled Nursing Facility (SNF/NH)");
  });

  it("handles missing and forward-compatible values", () => {
    expect(facilityTypeLabel(null)).toBe("Unknown facility type");
    expect(facilityTypeLabel("FUTURE_TYPE")).toBe("FUTURE_TYPE");
  });
});
