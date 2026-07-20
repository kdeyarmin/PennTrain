import { describe, expect, it } from "vitest";
import {
  canAccessProductPath,
  moduleHomePathForRole,
  parseBuildProductModules,
  productModuleForPath,
  withModuleDependencies,
} from "./productModules";

describe("product module routing", () => {
  it("classifies shared, Train, and CareBase routes", () => {
    expect(productModuleForPath("/app/employees/employee-id")).toBe("core");
    expect(productModuleForPath("/app/courses/course-id")).toBe("train");
    expect(productModuleForPath("/me/courses/assignment-id/quiz/quiz-id")).toBe("train");
    expect(productModuleForPath("/app/residents/resident-id")).toBe("carebase");
    expect(productModuleForPath("/app/state-forms?status=due")).toBe("carebase");
    expect(productModuleForPath("/features")).toBeNull();
  });

  it("makes CareBase include Train", () => {
    expect([...withModuleDependencies(["carebase"])]).toEqual(["core", "carebase", "train"]);
    expect([...parseBuildProductModules("carebase")]).toEqual(["core", "carebase", "train"]);
  });

  it("keeps a Train-only facility out of CareBase routes", () => {
    const trainOnly = withModuleDependencies(["train"]);
    expect(canAccessProductPath("/app/training-matrix", trainOnly)).toBe(true);
    expect(canAccessProductPath("/app/employees", trainOnly)).toBe(true);
    expect(canAccessProductPath("/app/residents", trainOnly)).toBe(false);
    expect(moduleHomePathForRole("org_admin", trainOnly)).toBe("/app/training-matrix");
    expect(moduleHomePathForRole("employee", trainOnly)).toBe("/me/courses");
  });
});
