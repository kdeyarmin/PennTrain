import { describe, expect, it } from "vitest";
import { shouldBlockForMaintenance } from "./maintenanceMode";

describe("shouldBlockForMaintenance", () => {
  it("blocks non-admin roles when maintenance mode is on", () => {
    for (const role of ["org_admin", "facility_manager", "trainer", "employee", "auditor"]) {
      expect(shouldBlockForMaintenance(true, role)).toBe(true);
    }
  });

  it("never blocks platform admins (they must be able to turn it back off)", () => {
    expect(shouldBlockForMaintenance(true, "platform_admin")).toBe(false);
  });

  it("does not block anyone when maintenance mode is off", () => {
    expect(shouldBlockForMaintenance(false, "employee")).toBe(false);
    expect(shouldBlockForMaintenance(false, "org_admin")).toBe(false);
  });

  it("fails open while the status is unknown (undefined) or the role is missing", () => {
    // usePlatformStatus() is undefined while loading -- must not gate anyone during that window.
    expect(shouldBlockForMaintenance(undefined, "employee")).toBe(false);
    // A confirmed maintenance flag with a not-yet-resolved role still gates (default-deny for
    // non-admins), since role only resolves to platform_admin for actual admins.
    expect(shouldBlockForMaintenance(true, undefined)).toBe(true);
  });
});
