import { describe, expect, it } from "vitest";
import {
  canViewPage,
  canViewPath,
  canonicalHelpPathForRole,
  helpBasePathForRole,
  safePathForRole,
  pagesForRole,
  searchPages,
  searchCommandActions,
} from "./appDomains";

describe("role-based page visibility", () => {
  it("keeps employees in the self-service surface", () => {
    const employeePaths = pagesForRole("employee").map((page) => page.path);

    expect(employeePaths).toEqual(expect.arrayContaining([
      "/me",
      "/me/schedule",
      "/me/courses",
      "/me/trainings",
      "/me/certificates",
      "/me/documents",
      "/me/credentials",
      "/me/attestations",
      "/me/help",
    ]));
    expect(employeePaths.some((path) => path.startsWith("/admin") || path.startsWith("/app") || path.startsWith("/trainer"))).toBe(false);
  });

  it("does not expose cross-prefix help pages to the wrong role", () => {
    expect(canViewPage("/app/help", "employee")).toBe(false);
    expect(canViewPage("/me/help", "org_admin")).toBe(false);
    expect(canViewPage("/app/help", "trainer")).toBe(true);
    expect(canViewPage("/me/help", "employee")).toBe(true);
  });

  it("uses the employee help prefix only for employees", () => {
    expect(helpBasePathForRole("employee")).toBe("/me");
    expect(helpBasePathForRole("trainer")).toBe("/app");
    expect(helpBasePathForRole("org_admin")).toBe("/app");
    expect(helpBasePathForRole("platform_admin")).toBeNull();
    expect(canonicalHelpPathForRole("/app/help/tickets/t1", "employee")).toBe("/me/help/tickets/t1");
    expect(canonicalHelpPathForRole("/me/help/tickets/t1", "trainer")).toBe("/app/help/tickets/t1");
    expect(canonicalHelpPathForRole("/app/help/tickets/t1?reply=1", "employee")).toBe("/me/help/tickets/t1?reply=1");
  });

  it("keeps trainer-only pages out of manager navigation and search", () => {
    expect(canViewPage("/trainer/retraining", "trainer")).toBe(true);
    expect(canViewPage("/trainer/retraining", "org_admin")).toBe(false);
    expect(canViewPage("/trainer/retraining", "facility_manager")).toBe(false);
  });

  it("uses trainer-prefixed dashboard and directory pages for trainers", () => {
    expect(canViewPage("/trainer", "trainer")).toBe(true);
    expect(canViewPage("/trainer/facilities", "trainer")).toBe(true);
    expect(canViewPage("/trainer/employees", "trainer")).toBe(true);
    expect(canViewPage("/app", "trainer")).toBe(false);
    expect(canViewPage("/app/facilities", "trainer")).toBe(false);
    expect(canViewPage("/app/employees", "trainer")).toBe(false);
    expect(canViewPath("/trainer/employees/employee-1", "trainer")).toBe(true);
    expect(canViewPath("/app/employees/employee-1", "trainer")).toBe(false);
  });

  it("shows pending approvals to operational training reviewers only", () => {
    expect(canViewPage("/app/pending-approvals", "org_admin")).toBe(true);
    expect(canViewPage("/app/pending-approvals", "facility_manager")).toBe(true);
    expect(canViewPage("/app/pending-approvals", "trainer")).toBe(true);
    expect(canViewPage("/app/pending-approvals", "auditor")).toBe(false);
    expect(canViewPage("/app/pending-approvals", "employee")).toBe(false);
  });

  it("exposes only facility-scoped audit evidence to facility managers", () => {
    expect(canViewPage("/app/audit", "org_admin")).toBe(true);
    expect(canViewPage("/app/audit", "facility_manager")).toBe(true);
    expect(canViewPage("/app/audit", "auditor")).toBe(true);
    expect(canViewPage("/app/audit", "trainer")).toBe(false);
    expect(canViewPage("/app/audit", "employee")).toBe(false);
  });

  it("limits the enterprise control plane to platform and organization administrators", () => {
    expect(canViewPage("/admin/enterprise", "platform_admin")).toBe(true);
    expect(canViewPage("/app/enterprise", "org_admin")).toBe(true);
    expect(canViewPage("/app/enterprise", "facility_manager")).toBe(false);
    expect(canViewPage("/app/enterprise", "trainer")).toBe(false);
    expect(canViewPage("/app/enterprise", "auditor")).toBe(false);
    expect(canViewPage("/app/enterprise", "employee")).toBe(false);
  });

  it("limits qualified workforce operations to platform and tenant managers", () => {
    expect(canViewPage("/admin/qualified-workforce", "platform_admin")).toBe(true);
    expect(canViewPage("/app/workforce-operations", "org_admin")).toBe(true);
    expect(canViewPage("/app/workforce-operations", "facility_manager")).toBe(true);
    expect(canViewPage("/app/workforce-operations", "trainer")).toBe(false);
    expect(canViewPage("/app/workforce-operations", "auditor")).toBe(false);
    expect(canViewPage("/app/workforce-operations", "employee")).toBe(false);
  });

  it("limits governed content operations to platform and tenant managers", () => {
    expect(canViewPage("/admin/governed-learning", "platform_admin")).toBe(true);
    expect(canViewPage("/app/governed-learning", "org_admin")).toBe(true);
    expect(canViewPage("/app/governed-learning", "facility_manager")).toBe(true);
    expect(canViewPage("/app/governed-learning", "trainer")).toBe(false);
    expect(canViewPage("/app/governed-learning", "employee")).toBe(false);
  });

  it("exposes closed-loop compliance to reporting roles only", () => {
    expect(canViewPage("/admin/closed-loop-compliance", "platform_admin")).toBe(true);
    expect(canViewPage("/app/closed-loop-compliance", "org_admin")).toBe(true);
    expect(canViewPage("/app/closed-loop-compliance", "facility_manager")).toBe(true);
    expect(canViewPage("/app/closed-loop-compliance", "auditor")).toBe(true);
    expect(canViewPage("/app/closed-loop-compliance", "trainer")).toBe(false);
    expect(canViewPage("/app/closed-loop-compliance", "employee")).toBe(false);
  });

  it("makes account MFA settings available to every authenticated role", () => {
    for (const role of ["platform_admin", "org_admin", "facility_manager", "trainer", "auditor", "employee"] as const) {
      expect(canViewPage("/account/security", role)).toBe(true);
      expect(canViewPath("/account/security", role)).toBe(true);
    }
  });

  it("checks nested paths against the owning visible page", () => {
    expect(canViewPath("/me/courses/assignment-1/quiz/quiz-1", "employee")).toBe(true);
    expect(canViewPath("/app/help/tickets/t1", "employee")).toBe(true);
    expect(canViewPath("/app/schedule/setup?facility=f1", "org_admin")).toBe(true);
    expect(canViewPath("/app/pending-approvals/anything", "auditor")).toBe(false);
    expect(canViewPath("/admin/settings", "employee")).toBe(false);
  });

  it("keeps stored links inside the current role surface", () => {
    expect(safePathForRole("/app/help/tickets/t1", "employee")).toBe("/me/help/tickets/t1");
    expect(safePathForRole("/me/courses/assignment-1", "trainer")).toBe("/me/courses/assignment-1");
    expect(safePathForRole("/app/employees/employee-1?tab=training", "trainer")).toBe("/trainer/employees/employee-1?tab=training");
    expect(safePathForRole("/me/certificates", "trainer")).toBe("/trainer");
    expect(safePathForRole("/app/users", "employee")).toBe("/me");
    expect(safePathForRole("/admin/settings", "org_admin")).toBe("/app");
  });

  it("surfaces role-aware command actions for Phase 1 workflow shortcuts", () => {
    expect(searchCommandActions("add employee", "org_admin").map((action) => action.path)).toContain("/app/employees?action=add");
    expect(searchCommandActions("bulk import", "facility_manager").map((action) => action.path)).toContain("/app/employees?action=bulk-import");
    expect(searchCommandActions("ai training", "platform_admin").map((action) => action.path)).toContain("/admin/courses/new-ai");
    expect(searchCommandActions("ai training", "org_admin")).toEqual([]);
    expect(searchCommandActions("bulk import", "employee")).toEqual([]);
  });

  it("excludes template detail routes from generic page search results", () => {
    const paths = searchPages("resident chart", "platform_admin").map((page) => page.path);
    expect(paths).not.toContain("/admin/residents/:id");
  });

});
