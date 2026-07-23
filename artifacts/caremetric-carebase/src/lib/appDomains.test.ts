import { describe, expect, it } from "vitest";
import {
  canViewPage,
  canViewPath,
  canonicalHelpPathForRole,
  helpBasePathForRole,
  safePathForRole,
  viewablePathForRole,
  pagesForRole,
  searchPages,
  searchCommandActions,
} from "./appDomains";
import { withModuleDependencies } from "./productModules";

describe("role-based page visibility", () => {
  it("keeps employees in the self-service surface", () => {
    const employeePaths = pagesForRole("employee").map((page) => page.path);

    expect(employeePaths).toEqual(expect.arrayContaining([
      "/me",
      "/me/schedule",
      "/me/shift",
      "/me/services",
      "/me/change-of-condition",
      "/me/courses",
      "/me/trainings",
      "/me/work",
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

  it("authorizes guided workflow links that include an action query", () => {
    expect(canViewPath("/app/employees?action=add", "org_admin")).toBe(true);
    expect(canViewPath("/app/employees?action=add", "facility_manager")).toBe(true);
    expect(canViewPath("/app/employees?action=add", "employee")).toBe(false);
  });

  it("shows pending approvals to operational training reviewers only", () => {
    expect(canViewPage("/app/pending-approvals", "org_admin")).toBe(true);
    expect(canViewPage("/app/pending-approvals", "facility_manager")).toBe(true);
    expect(canViewPage("/app/pending-approvals", "trainer")).toBe(true);
    expect(canViewPage("/app/pending-approvals", "auditor")).toBe(false);
    expect(canViewPage("/app/pending-approvals", "employee")).toBe(false);
  });

  it("exposes only facility-scoped audit documentation to facility managers", () => {
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

  it("exposes scoped operational work and employee self-service work", () => {
    expect(canViewPage("/app/work", "platform_admin")).toBe(true);
    expect(canViewPage("/app/work", "org_admin")).toBe(true);
    expect(canViewPage("/app/work", "facility_manager")).toBe(true);
    expect(canViewPage("/app/work", "auditor")).toBe(true);
    expect(canViewPage("/app/work", "employee")).toBe(false);
    expect(canViewPage("/me/work", "employee")).toBe(true);
    expect(canViewPath("/me/work/work-1", "employee")).toBe(true);
    expect(canViewPath("/app/work/work-1", "auditor")).toBe(true);
  });

  it("separates manager service oversight from employee service delivery", () => {
    expect(canViewPage("/app/services", "platform_admin")).toBe(true);
    expect(canViewPage("/app/services", "org_admin")).toBe(true);
    expect(canViewPage("/app/services", "facility_manager")).toBe(true);
    expect(canViewPage("/app/services", "auditor")).toBe(true);
    expect(canViewPage("/app/services", "employee")).toBe(false);
    expect(canViewPage("/me/services", "employee")).toBe(true);
    expect(canViewPage("/me/services", "org_admin")).toBe(false);
  });

  it("exposes admission, room, move-in, and census operations to reporting roles", () => {
    expect(canViewPage("/app/admissions", "platform_admin")).toBe(true);
    expect(canViewPage("/app/admissions", "org_admin")).toBe(true);
    expect(canViewPage("/app/admissions", "facility_manager")).toBe(true);
    expect(canViewPage("/app/admissions", "auditor")).toBe(true);
    expect(canViewPage("/app/admissions", "employee")).toBe(false);
    expect(canViewPath("/app/admissions/move-ins/workspace-1", "org_admin")).toBe(true);
  });

  it("separates manager change oversight from assigned employee follow-up", () => {
    expect(canViewPage("/app/change-of-condition", "platform_admin")).toBe(true);
    expect(canViewPage("/app/change-of-condition", "org_admin")).toBe(true);
    expect(canViewPage("/app/change-of-condition", "facility_manager")).toBe(true);
    expect(canViewPage("/app/change-of-condition", "auditor")).toBe(true);
    expect(canViewPage("/app/change-of-condition", "employee")).toBe(false);
    expect(canViewPage("/me/change-of-condition", "employee")).toBe(true);
    expect(canViewPath("/me/change-of-condition/event-1", "employee")).toBe(true);
    expect(canViewPath("/app/change-of-condition/event-1", "auditor")).toBe(true);
  });

  it("exposes QAPI projects to reporting roles", () => {
    expect(canViewPage("/app/qapi", "org_admin")).toBe(true);
    expect(canViewPage("/app/qapi", "facility_manager")).toBe(true);
    expect(canViewPage("/app/qapi", "auditor")).toBe(true);
    expect(canViewPage("/app/qapi", "employee")).toBe(false);
    expect(canViewPath("/app/qapi/projects/project-1", "org_admin")).toBe(true);
  });

  it("separates dietary oversight from employee dietary rounds", () => {
    expect(canViewPage("/app/dietary-operations", "platform_admin")).toBe(true);
    expect(canViewPage("/app/dietary-operations", "org_admin")).toBe(true);
    expect(canViewPage("/app/dietary-operations", "facility_manager")).toBe(true);
    expect(canViewPage("/app/dietary-operations", "auditor")).toBe(true);
    expect(canViewPage("/app/dietary-operations", "employee")).toBe(false);
    expect(canViewPage("/me/dietary-operations", "employee")).toBe(true);
    expect(canViewPage("/me/dietary-operations", "auditor")).toBe(false);
  });

  it("separates resident calendar oversight from assigned employee services", () => {
    expect(canViewPage("/app/resident-services-calendar", "platform_admin")).toBe(true);
    expect(canViewPage("/app/resident-services-calendar", "org_admin")).toBe(true);
    expect(canViewPage("/app/resident-services-calendar", "facility_manager")).toBe(true);
    expect(canViewPage("/app/resident-services-calendar", "auditor")).toBe(true);
    expect(canViewPage("/app/resident-services-calendar", "employee")).toBe(false);
    expect(canViewPage("/me/resident-services-calendar", "employee")).toBe(true);
    expect(canViewPage("/me/resident-services-calendar", "auditor")).toBe(false);
  });

  it("limits resident financial operations to management and audit roles", () => {
    expect(canViewPage("/app/resident-finance", "platform_admin")).toBe(true);
    expect(canViewPage("/app/resident-finance", "org_admin")).toBe(true);
    expect(canViewPage("/app/resident-finance", "facility_manager")).toBe(true);
    expect(canViewPage("/app/resident-finance", "auditor")).toBe(true);
    expect(canViewPage("/app/resident-finance", "employee")).toBe(false);
    expect(canViewPage("/app/resident-finance", "trainer")).toBe(false);
  });

  it("restricts the regulatory copilot to compliance reporting roles", () => {
    expect(canViewPage("/admin/regulatory-copilot", "platform_admin")).toBe(true);
    expect(canViewPage("/app/regulatory-copilot", "platform_admin")).toBe(false);
    expect(canViewPage("/app/regulatory-copilot", "org_admin")).toBe(true);
    expect(canViewPage("/app/regulatory-copilot", "facility_manager")).toBe(true);
    expect(canViewPage("/app/regulatory-copilot", "auditor")).toBe(true);
    expect(canViewPage("/app/regulatory-copilot", "trainer")).toBe(false);
    expect(canViewPage("/app/regulatory-copilot", "employee")).toBe(false);
  });

  it("makes account MFA settings available to every authenticated role", () => {
    for (const role of ["platform_admin", "org_admin", "facility_manager", "trainer", "auditor", "employee"] as const) {
      expect(canViewPage("/account/security", role)).toBe(true);
      expect(canViewPath("/account/security", role)).toBe(true);
    }
  });

  it("checks nested paths against the owning visible page", () => {
    expect(canViewPath("/admin/incidents/incident-1", "platform_admin")).toBe(true);
    expect(canViewPath("/admin/inspections/inspection-1", "platform_admin")).toBe(true);
    expect(canViewPath("/admin/residents/resident-1", "platform_admin")).toBe(true);
    expect(canViewPath("/admin/residents/resident-1/assessment-forms/form-1", "platform_admin")).toBe(true);
    expect(canViewPath("/admin/quizzes/quiz-1", "platform_admin")).toBe(true);
    expect(canViewPath("/me/courses/assignment-1/quiz/quiz-1", "employee")).toBe(true);
    expect(canViewPath("/app/help/tickets/t1", "employee")).toBe(true);
    expect(canViewPath("/app/schedule/setup?facility=f1", "org_admin")).toBe(true);
    expect(canViewPath("/app/pending-approvals/anything", "auditor")).toBe(false);
    expect(canViewPath("/admin/settings", "employee")).toBe(false);
  });

  it("rejects unknown descendants of root app prefixes", () => {
    expect(canViewPath("/app/not-a-real-page", "org_admin")).toBe(false);
    expect(canViewPath("/admin/not-a-real-page", "platform_admin")).toBe(false);
    expect(canViewPath("/trainer/not-a-real-page", "trainer")).toBe(false);
    expect(canViewPath("/me/not-a-real-page", "employee")).toBe(false);
    expect(safePathForRole("/app/not-a-real-page", "org_admin")).toBe("/app/today");
  });

  it("does not infer nested ownership for pages without detail routes", () => {
    expect(canViewPath("/app/settings/not-a-real-page", "org_admin")).toBe(false);
    expect(canViewPath("/account/security/not-a-real-page", "employee")).toBe(false);
    expect(canViewPath("/admin/settings/not-a-real-page", "platform_admin")).toBe(false);
    expect(safePathForRole("/app/settings/not-a-real-page", "org_admin")).toBe("/app/today");
  });

  it("keeps stored links inside the current role surface", () => {
    expect(safePathForRole("/app/help/tickets/t1", "employee")).toBe("/me/help/tickets/t1");
    expect(safePathForRole("/me/courses/assignment-1", "trainer")).toBe("/me/courses/assignment-1");
    expect(safePathForRole("/app/employees/employee-1?tab=training", "trainer")).toBe("/trainer/employees/employee-1?tab=training");
    expect(safePathForRole("/me/certificates", "trainer")).toBe("/trainer");
    expect(safePathForRole("/app/users", "employee")).toBe("/me");
    expect(safePathForRole("/admin/settings", "org_admin")).toBe("/app/today");
  });

  it("returns only viewable canonical destinations for related links", () => {
    expect(viewablePathForRole("/app/employees/employee-1?tab=training", "trainer")).toBe("/trainer/employees/employee-1?tab=training");
    expect(viewablePathForRole("/app/help/tickets/t1", "employee")).toBe("/me/help/tickets/t1");
    expect(viewablePathForRole("/app/resident-services-calendar", "employee")).toBe("/me/resident-services-calendar");
    expect(viewablePathForRole("/app/users", "employee")).toBeNull();
    expect(viewablePathForRole("/app/settings/not-a-real-page", "org_admin")).toBeNull();
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

describe("module-aware page filtering", () => {
  const trainOnly = withModuleDependencies(["train"]); // resolves to {core, train}

  it("excludes CareBase-only pages from pagesForRole when Train-only modules are enabled", () => {
    const paths = pagesForRole("org_admin", trainOnly).map((page) => page.path);

    // CareBase-module pages must be absent
    expect(paths).not.toContain("/app/residents");
    expect(paths).not.toContain("/app/admissions");
    expect(paths).not.toContain("/app/change-of-condition");
    expect(paths).not.toContain("/app/qapi");
    expect(paths).not.toContain("/app/emergency");

    // Core and Train pages must remain accessible
    expect(paths).toContain("/app/employees");
    expect(paths).toContain("/app/training-matrix");
    expect(paths).toContain("/app/governed-learning");
    expect(paths).toContain("/app/pending-approvals");
  });

  it("blocks CareBase paths and allows Train/core paths via canViewPage with Train-only modules", () => {
    expect(canViewPage("/app/residents", "org_admin", trainOnly)).toBe(false);
    expect(canViewPage("/app/admissions", "org_admin", trainOnly)).toBe(false);
    expect(canViewPage("/app/change-of-condition", "org_admin", trainOnly)).toBe(false);
    expect(canViewPage("/app/training-matrix", "org_admin", trainOnly)).toBe(true);
    expect(canViewPage("/app/employees", "org_admin", trainOnly)).toBe(true);
  });

  it("excludes CareBase pages from searchPages results with Train-only modules", () => {
    const paths = searchPages("residents", "org_admin", trainOnly).map((page) => page.path);
    expect(paths).not.toContain("/app/residents");
    expect(paths).not.toContain("/app/admissions");
  });

  it("excludes CareBase command actions from searchCommandActions with Train-only modules", () => {
    const actions = searchCommandActions("compliance", "org_admin", trainOnly);
    const paths = actions.map((a) => a.path);
    // CareBase paths like /app/compliance-binder should be absent
    expect(paths).not.toContain("/app/compliance-binder");
  });
});
