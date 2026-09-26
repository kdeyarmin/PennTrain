import { describe, expect, it } from "vitest";
import { incidentTypesForFacility } from "./incidentTypes";
describe("chapter-specific incident categories", () => {
  it("keeps 2800.16(a)(20) out of PCH filing choices", () => {
    expect(incidentTypesForFacility("PCH")).not.toContain("inadequate_staffing");
    expect(incidentTypesForFacility("ALR")).toContain("inadequate_staffing");
  });
  it("offers the missing statutory categories regardless of severity", () => {
    expect(incidentTypesForFacility("PCH")).toEqual(expect.arrayContaining(["suicide_attempt", "food_poisoning", "utility_termination_notice", "resident_rights_violation"]));
  });
});
