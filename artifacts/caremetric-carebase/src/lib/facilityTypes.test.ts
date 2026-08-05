import { describe, it, expect } from "vitest";
import { facilityTypeLabel, facilityTypeMatchesQuery, hasAnyFacilityType, PCH_ALR_ONLY_FACILITY_TYPES } from "./facilityTypes";

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
    expect(facilityTypeLabel(null)).toBe("Unknown");
    expect(facilityTypeLabel("FUTURE_TYPE")).toBe("FUTURE_TYPE");
  });
});

describe("facilityTypeMatchesQuery", () => {
  // The stored code is "ALR" and the label is "Assisted Living Facility (ALF)". A search that only
  // looked at the code answered to the term the product forbids showing and not to the one it
  // displays.
  it("matches an ALR facility by the ALF label the product actually shows", () => {
    expect(facilityTypeMatchesQuery("ALR", "alf")).toBe(true);
    expect(facilityTypeMatchesQuery("ALR", "assisted living")).toBe(true);
    expect(facilityTypeMatchesQuery("ALR", "alr")).toBe(true);
  });

  // The predicate this replaced was `query.includes("alf")` -- an inverted substring test, so any
  // query merely CONTAINING those letters returned every ALF record.
  it("does not treat 'half' as an ALF search", () => {
    expect(facilityTypeMatchesQuery("ALR", "half")).toBe(false);
    expect(facilityTypeMatchesQuery("ALR", "ralf")).toBe(false);
  });

  it("still matches PCH by code and by label", () => {
    expect(facilityTypeMatchesQuery("PCH", "pch")).toBe(true);
    expect(facilityTypeMatchesQuery("PCH", "personal care")).toBe(true);
    expect(facilityTypeMatchesQuery("PCH", "alf")).toBe(false);
  });
});
