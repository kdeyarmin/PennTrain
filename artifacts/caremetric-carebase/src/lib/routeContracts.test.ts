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

  // The credential-renewal and qualification notifications choose their link from the RECIPIENT's
  // role (20260906280000). That choice is only correct if the page it names is one that role can
  // actually open, and for `trainer` it was not: CREDENTIAL_ROLES deliberately keeps trainers off
  // the manager-facing page, and the self-service one was gated to `employee` alone, so a trainer
  // holding an employee record was sent to a route that redirects them away from their own
  // approved clearance. These two assertions are the contract that branch depends on.
  it("gives a trainer somewhere to read their own credential", () => {
    expect(canViewPath("/me/credentials", "trainer")).toBe(true);
    expect(canViewPath("/me/credentials", "employee")).toBe(true);
    // And the manager-facing page stays closed to them, which is why the branch exists at all --
    // employee_credentials_select excludes trainers from other people's clearance data.
    expect(canViewPath("/app/credentials", "trainer")).toBe(false);
    expect(canViewPath("/app/credentials", "facility_manager")).toBe(true);
  });

  // `grant_additional_quiz_attempt` (20260906130000) notifies the profile behind an employee row,
  // which is whatever role that person holds -- a facility_manager, trainer or auditor can have an
  // employee record. So the link it writes has to be reachable by all of them. It named
  // /me/trainings, which is employee-only; taking an assigned course is not an employee-only act
  // and /me/courses is ANY_ROLE for that reason.
  it("keeps the assigned-course destination open to every role that can hold an assignment", () => {
    for (const role of ["employee", "trainer", "facility_manager", "org_admin", "auditor"] as const) {
      expect(canViewPath("/me/courses", role)).toBe(true);
    }
    // The page the notification used to name is self-service only, which is the defect.
    expect(canViewPath("/me/trainings", "trainer")).toBe(false);
  });

  it("redirects legacy paths to destinations visible to their intended roles", () => {
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/my-trainings"], "employee")).toBe(true);
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/my-schedule"], "employee")).toBe(true);
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/policies"], "org_admin")).toBe(true);
    expect(canViewPath(LEGACY_ROUTE_REDIRECTS["/app/shift-log"], "facility_manager")).toBe(true);
  });
});
