import { describe, expect, it } from "vitest";
import { roleQuickStartItems } from "./roleQuickStart";

describe("roleQuickStartItems", () => {
  it("starts CareBase managers and auditors on Today", () => {
    expect(roleQuickStartItems("org_admin")[0]?.href).toBe("/app/today");
    expect(roleQuickStartItems("facility_manager")[0]?.href).toBe("/app/today");
    expect(roleQuickStartItems("auditor")[0]?.href).toBe("/app/today");
  });

  it("keeps employee quick starts inside self-service", () => {
    expect(roleQuickStartItems("employee").every((item) => item.href.startsWith("/me"))).toBe(true);
  });

  it("returns no checklist for unknown roles", () => {
    expect(roleQuickStartItems(undefined)).toEqual([]);
    expect(roleQuickStartItems("guest")).toEqual([]);
  });
});
