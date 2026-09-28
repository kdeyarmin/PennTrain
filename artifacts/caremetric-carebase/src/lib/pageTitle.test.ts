import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pageBreadcrumbs, pathFallbackLabel, registryLabelForPath } from "./pageTitle";
import { viewablePathForRole } from "./appDomains";
import { withModuleDependencies } from "./productModules";

// Unknown routes still need a readable fallback without exposing raw record IDs as navigation.
describe("pathFallbackLabel", () => {
  it("uses the parent segment when the tail is a record id, rather than title-casing the id", () => {
    // The exact string a browser journey found sitting in the sidebar under RECENT.
    expect(pathFallbackLabel("/app/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Residents");
    expect(pathFallbackLabel("/me/change-of-condition/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe(
      "Change Of Condition",
    );
    expect(pathFallbackLabel("/trainer/classes/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Classes");
  });

  it("treats a bare number as a record id too", () => {
    expect(pathFallbackLabel("/app/incidents/4210")).toBe("Incidents");
  });

  it("title-cases a meaningful tail segment and un-slugs it", () => {
    expect(pathFallbackLabel("/app/change-of-condition")).toBe("Change Of Condition");
    // A trailing sub-route after an id keeps its own name -- the id is not the last segment.
    expect(pathFallbackLabel("/app/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8/chart")).toBe("Chart");
  });

  it("ignores a query string or fragment instead of title-casing it", () => {
    expect(pathFallbackLabel("/app/incidents?status=open")).toBe("Incidents");
    expect(pathFallbackLabel("/app/incidents#top")).toBe("Incidents");
  });

  it("never returns an empty label", () => {
    expect(pathFallbackLabel("/")).toBe("Dashboard");
    expect(pathFallbackLabel("")).toBe("Dashboard");
    // A bare id with no parent segment has nothing better to fall back to, but still must not be blank.
    expect(pathFallbackLabel("/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).not.toBe("");
  });
});

describe("registryLabelForPath", () => {
  it("prefers an exact registry path", () => {
    expect(registryLabelForPath("/admin/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Resident chart");
  });

  it("labels detail and nested routes without exposing identifiers", () => {
    expect(registryLabelForPath("/app/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Resident details");
    expect(registryLabelForPath("/me/courses/assignment/quiz/quiz-id")).toBe("Training quiz");
    expect(registryLabelForPath("/app/schedule/setup")).toBe("Schedule setup");
    expect(registryLabelForPath("/app/maintenance/scan/equipment/token")).toBe("Maintenance QR scan");
    expect(registryLabelForPath("/app/unknown-page")).toBeNull();
  });

  it("provides a title for every protected detail route in both entry points", () => {
    for (const entryPoint of ["App.tsx", "TrainApp.tsx"]) {
      const source = readFileSync(resolve(__dirname, "..", entryPoint), "utf8");
      const routes = source.split("<Route ").slice(1).flatMap((chunk) => {
        const path = chunk.match(/^path="([^"]+)"/)?.[1];
        return path?.includes(":") && chunk.includes("<ProtectedRoute") ? [path] : [];
      });
      expect(routes.filter((path) => !registryLabelForPath(path.replace(/:[^/]+/g, "record-id")))).toEqual([]);
    }
  });
});

describe("pageBreadcrumbs", () => {
  const modules = withModuleDependencies(["carebase"]);
  const managerPath = (path: string) => viewablePathForRole(path, "org_admin", modules);

  it("links to real nested ancestors and the role's home", () => {
    expect(pageBreadcrumbs("/app/residents/resident-id/chart?tab=vitals", "Clinical chart", "/app/today", managerPath)).toEqual([
      { label: "Home", path: "/app/today" },
      { label: "Residents", path: "/app/residents" },
      { label: "Resident details", path: "/app/residents/resident-id" },
      { label: "Clinical chart" },
    ]);
  });

  it("does not fabricate a page for intermediate URL segments", () => {
    expect(pageBreadcrumbs("/app/maintenance/scan/equipment/token", "Maintenance QR scan", "/app/today", managerPath)).toEqual([
      { label: "Home", path: "/app/today" },
      { label: "Maintenance & work orders", path: "/app/maintenance" },
      { label: "Maintenance QR scan" },
    ]);
    expect(pageBreadcrumbs("/app/qapi/projects/project-id", "Quality improvement project", "/app/today", managerPath).map((crumb) => crumb.path)).not.toContain("/app/qapi/projects");
  });

  it("keeps trainer links in their own directory and skips inaccessible ancestors", () => {
    expect(pageBreadcrumbs("/app/employees/staff-id", "Employee details", "/trainer", (path) => viewablePathForRole(path, "trainer", modules))).toEqual([
      { label: "Home", path: "/trainer" },
      { label: "Employees", path: "/trainer/employees" },
      { label: "Employee details" },
    ]);
    expect(pageBreadcrumbs("/app/residents/id/chart", "Clinical chart", "/admin", (path) => viewablePathForRole(path, "platform_admin", modules))).toEqual([
      { label: "Home", path: "/admin" }, { label: "Clinical chart" },
    ]);
  });

  it("does not duplicate a home page in its own breadcrumb", () => {
    expect(pageBreadcrumbs("/app/train", "Train workspace", "/app/train", managerPath)).toEqual([{ label: "Train workspace" }]);
  });
});
