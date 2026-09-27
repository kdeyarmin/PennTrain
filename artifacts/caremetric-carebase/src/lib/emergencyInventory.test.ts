import { describe, expect, it } from "vitest";
import { emergencyInventoryStatus } from "./emergencyInventory";

describe("emergency supply readiness", () => {
  const item = { status: "ready", quantity: 12, minimum_quantity: 10, expiration_date: null };
  it("flags expired stock without waiting for a manual status change", () => {
    expect(emergencyInventoryStatus({ ...item, expiration_date: "2026-09-25" }, "2026-09-26")).toBe("expired");
  });
  it("keeps stock valid through its expiration calendar day", () => {
    expect(emergencyInventoryStatus({ ...item, expiration_date: "2026-09-26" }, "2026-09-26")).toBe("ready");
  });
  it("flags a shortfall and clears the computed warning after replenishment", () => {
    expect(emergencyInventoryStatus({ ...item, quantity: "2" }, "2026-09-26")).toBe("low");
    expect(emergencyInventoryStatus(item, "2026-09-26")).toBe("ready");
  });
  it("preserves a staff-recorded warning even when quantities look sufficient", () => {
    for (const status of ["low", "expired", "unavailable"]) expect(emergencyInventoryStatus({ ...item, status }, "2026-09-26")).toBe(status);
  });
});
