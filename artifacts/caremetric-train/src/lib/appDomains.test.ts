import { describe, expect, it } from "vitest";
import {
  canViewPage,
  canViewPath,
  canonicalHelpPathForRole,
  helpBasePathForRole,
  safePathForRole,
  pagesForRole,
  searchCommandActions,
} from "./appDomains";

describe("role-based page visibility", () => {
  it("keeps employee learners in the self-service surface", () => {
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

  it("uses the employee help prefix only for employee learners", () => {
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
    expect(searchCommandActions("ai course", "platform_admin").map((action) => action.path)).toContain("/admin/courses/new-ai");
    expect(searchCommandActions("ai course", "org_admin")).toEqual([]);
    expect(searchCommandActions("bulk import", "employee")).toEqual([]);
  });

});
