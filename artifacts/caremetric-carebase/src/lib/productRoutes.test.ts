import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRAIN_ROUTE_PATTERNS, pathAvailableInBuild } from "./productRoutes";
import { canViewPath, commandActionsForRole, pagesForRole, searchPages } from "./appDomains";
import { withModuleDependencies } from "./productModules";
import type { Role } from "./auth";

afterEach(() => vi.unstubAllEnvs());

describe("product route availability", () => {
  it("matches every route actually shipped by Train", () => {
    const source = readFileSync(resolve(__dirname, "../TrainApp.tsx"), "utf8");
    const declared = [...source.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
    expect([...TRAIN_ROUTE_PATTERNS].sort()).toEqual(declared.sort());
    expect(source).toContain("<Route component={NotFound} />");
  });

  it("allows real Train details and rejects omitted or malformed pages", () => {
    expect(pathAvailableInBuild("/me/courses/assignment/quiz/quiz-id?attempt=1", "train")).toBe(true);
    expect(pathAvailableInBuild("/admin/training-reports", "train")).toBe(true);
    expect(pathAvailableInBuild("/admin/organizations", "train")).toBe(false);
    expect(pathAvailableInBuild("/app/settings/nonexistent", "train")).toBe(false);
    expect(pathAvailableInBuild("/app/residents", "carebase")).toBe(true);
  });

  it("filters navigation, search, quick actions and stored links for every Train role", () => {
    vi.stubEnv("VITE_APP_PRODUCT", "train");
    const modules = withModuleDependencies(["train"]);
    const roles: Role[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "auditor", "employee"];
    for (const role of roles) {
      expect(pagesForRole(role, modules).every((page) => pathAvailableInBuild(page.path, "train"))).toBe(true);
      expect(commandActionsForRole(role, modules).every((action) => pathAvailableInBuild(action.path, "train"))).toBe(true);
    }
    expect(searchPages("organizations", "platform_admin", modules)).toEqual([]);
    expect(canViewPath("/admin/organizations", "platform_admin", modules)).toBe(false);
    expect(canViewPath("/admin/training-reports", "platform_admin", modules)).toBe(true);
    expect(commandActionsForRole("platform_admin", modules).some((action) => action.id === "new-ai-course")).toBe(false);
  });
});
