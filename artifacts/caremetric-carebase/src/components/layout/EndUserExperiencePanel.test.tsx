import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ path: "/app/today", stored: null as string | null, modules: new Set(["core", "care"]) }));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => [h.path] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "person", role: "org_admin" } }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({ enabledModules: h.modules }) }));
vi.mock("@/hooks/useProductExperience", () => ({ useNavigationWorkspace: () => ({ recentPaths: [] }) }));
vi.mock("@/lib/appDomains", () => ({ canViewPath: () => true, commandActionsForRole: () => [] }));
import { EndUserExperiencePanel } from "./EndUserExperiencePanel";
beforeEach(() => {
  h.path = "/app/today"; h.stored = null; h.modules = new Set(["core", "care"]);
  vi.stubGlobal("window", { localStorage: { getItem: () => h.stored } });
});
describe("workspace guidance", () => {
  it("starts compact so the landing page's main task remains visible", () => {
    const html = renderToStaticMarkup(<EndUserExperiencePanel />);
    expect(html).toContain("Show guidance");
    expect(html).not.toContain('id="end-user-experience-panel-content"');
  });
  it("honors an explicitly expanded preference on the home page", () => {
    h.stored = "false";
    expect(renderToStaticMarkup(<EndUserExperiencePanel />)).toContain('id="end-user-experience-panel-content"');
  });
  it.each(["/app/residents/person", "/app/work/task", "/me/courses/course", "/me/quiz/quiz", "/app/settings"])("keeps guidance out of the focused workflow %s", path => {
    h.path = path; h.stored = "false";
    expect(renderToStaticMarkup(<EndUserExperiencePanel />)).toBe("");
  });
  it("lets the focused training workspace provide its own guidance", () => {
    h.modules = new Set(["core", "train"]);
    expect(renderToStaticMarkup(<EndUserExperiencePanel />)).toBe("");
  });
});
