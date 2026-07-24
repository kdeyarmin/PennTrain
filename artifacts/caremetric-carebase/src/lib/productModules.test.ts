import { describe, expect, it } from "vitest";
import {
  canAccessProductPath,
  moduleHomePathForRole,
  parseBuildProductModules,
  productModuleForPath,
  withModuleDependencies,
} from "./productModules";

describe("product module routing", () => {
  it("classifies shared, Train, and Care Operations routes", () => {
    expect(productModuleForPath("/app/employees/employee-id")).toBe("core");
    expect(productModuleForPath("/app/courses/course-id")).toBe("train");
    expect(productModuleForPath("/me/courses/assignment-id/quiz/quiz-id")).toBe("train");
    expect(productModuleForPath("/app/residents/resident-id")).toBe("carebase");
    expect(productModuleForPath("/app/resident-care-delivery")).toBe("carebase");
    expect(productModuleForPath("/features")).toBeNull();
  });

  it("classifies the carved Workforce, Compliance, and Billing pillars", () => {
    expect(productModuleForPath("/app/credentials")).toBe("workforce");
    expect(productModuleForPath("/app/schedule/setup")).toBe("workforce");
    expect(productModuleForPath("/me/schedule")).toBe("workforce");
    expect(productModuleForPath("/app/inspection-readiness")).toBe("compliance");
    expect(productModuleForPath("/app/state-forms?status=due")).toBe("compliance");
    expect(productModuleForPath("/app/violations/violation-id")).toBe("compliance");
    expect(productModuleForPath("/me/attestations")).toBe("compliance");
    expect(productModuleForPath("/app/resident-finance")).toBe("billing");
  });

  it("makes CareBase include every operational pillar", () => {
    expect([...withModuleDependencies(["carebase"])]).toEqual([
      "core",
      "carebase",
      "train",
      "workforce",
      "compliance",
      "billing",
    ]);
    expect([...parseBuildProductModules("carebase")]).toEqual([
      "core",
      "carebase",
      "train",
      "workforce",
      "compliance",
      "billing",
    ]);
  });

  it("keeps a Train-only facility out of pillar routes", () => {
    const trainOnly = withModuleDependencies(["train"]);
    expect(canAccessProductPath("/app/training-matrix", trainOnly)).toBe(true);
    expect(canAccessProductPath("/app/employees", trainOnly)).toBe(true);
    expect(canAccessProductPath("/app/residents", trainOnly)).toBe(false);
    expect(canAccessProductPath("/app/credentials", trainOnly)).toBe(false);
    expect(canAccessProductPath("/app/inspection-readiness", trainOnly)).toBe(false);
    expect(canAccessProductPath("/app/resident-finance", trainOnly)).toBe(false);
    expect(moduleHomePathForRole("org_admin", trainOnly)).toBe("/app/training-matrix");
    expect(moduleHomePathForRole("employee", trainOnly)).toBe("/me/courses");
  });

  it("scopes a Compliance pillar package to its own routes", () => {
    const essentials = withModuleDependencies(["train", "compliance"]);
    expect(canAccessProductPath("/app/inspection-readiness", essentials)).toBe(true);
    expect(canAccessProductPath("/app/state-forms", essentials)).toBe(true);
    expect(canAccessProductPath("/app/credentials", essentials)).toBe(false);
    expect(canAccessProductPath("/app/resident-finance", essentials)).toBe(false);
    expect(canAccessProductPath("/app/residents", essentials)).toBe(false);
    expect(moduleHomePathForRole("org_admin", withModuleDependencies(["compliance"]))).toBe(
      "/app/inspection-readiness",
    );
  });

  it("lands users on role-specific start pages in a CareBase organization", () => {
    const allModules = withModuleDependencies(["carebase"]);
    expect(moduleHomePathForRole("org_admin", allModules)).toBe("/app/today");
    expect(moduleHomePathForRole("facility_manager", allModules)).toBe("/app/today");
    expect(moduleHomePathForRole("auditor", allModules)).toBe("/app/today");
    expect(moduleHomePathForRole("employee", allModules)).toBe("/me");
  });
});
