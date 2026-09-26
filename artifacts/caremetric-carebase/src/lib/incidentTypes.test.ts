import { describe, expect, it } from "vitest";
import { incidentTypesForFacility, incidentNotificationLabel, INCIDENT_NOTIFICATION_TYPE_OPTIONS } from "./incidentTypes";
describe("chapter-specific incident categories", () => {
  it("offers independently named written OAPSA recipients", () => {
    expect(INCIDENT_NOTIFICATION_TYPE_OPTIONS).toEqual(expect.arrayContaining(["written_law_enforcement", "written_protective_services"]));
    expect(incidentNotificationLabel("written_law_enforcement")).toBe("Written report to law enforcement");
    expect(incidentNotificationLabel("written_protective_services")).toBe("Written report to protective services");
  });
  it("keeps 2800.16(a)(20) out of PCH filing choices", () => {
    expect(incidentTypesForFacility("PCH")).not.toContain("inadequate_staffing");
    expect(incidentTypesForFacility("ALR")).toContain("inadequate_staffing");
  });
  it("offers the missing statutory categories regardless of severity", () => {
    expect(incidentTypesForFacility("PCH")).toEqual(expect.arrayContaining(["suicide_attempt", "food_poisoning", "utility_termination_notice", "resident_rights_violation"]));
  });
});
