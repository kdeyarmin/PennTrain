import { describe, expect, it } from "vitest";
import { CANONICAL_ROUTES, LEGACY_ROUTE_REDIRECTS, canonicalInternalPath } from "./routeContracts";
import { APP_PAGES, canViewPath } from "./appDomains";

describe("internal route contract", () => {
  it("canonicalizes every historical destination that can still exist in notifications", () => {
    expect(canonicalInternalPath("/app/my-trainings")).toBe("/me/trainings");
    expect(canonicalInternalPath("/app/my-schedule?day=tomorrow")).toBe("/me/schedule?day=tomorrow");
    expect(canonicalInternalPath("/app/policies#current")).toBe("/app/policy-documents#current");
    expect(canonicalInternalPath("/app/work-orders/123")).toBe("/app/maintenance/123");
    expect(canonicalInternalPath("/admin/work-orders/456?from=search")).toBe("/app/maintenance/456?from=search");
  });

  it("registers every canonical destination in role-aware navigation", () => {
    const registered = new Set(APP_PAGES.map((page) => page.path));
    expect(registered.has(CANONICAL_ROUTES.employeeTrainings)).toBe(true);
    expect(registered.has(CANONICAL_ROUTES.employeeSchedule)).toBe(true);
    expect(registered.has(CANONICAL_ROUTES.policyDocuments)).toBe(true);
    expect(registered.has(CANONICAL_ROUTES.maintenance)).toBe(true);
    expect(registered.has(CANONICAL_ROUTES.shiftHandoffs)).toBe(true);
  });

  it("redirects legacy paths to destinations visible to their intended roles", () => {
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/my-trainings"], "employee")).toBe(true);
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/my-schedule"], "employee")).toBe(true);
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/policies"], "org_admin")).toBe(true);
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/shift-log"], "facility_manager")).toBe(true);
  });
});
