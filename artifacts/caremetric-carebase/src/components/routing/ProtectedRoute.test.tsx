import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "reviewer-a", organizationId: "org-a", role: "org_admin" },
  viewingOrgId: null as string | null,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user, isLoading: false, isAuthenticated: true }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.viewingOrgId }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({ isLoading: false, canAccessPath: () => true }) }));
vi.mock("@/hooks/usePlatformSettings", () => ({ usePlatformStatus: () => ({ data: { maintenanceMode: false } }) }));
vi.mock("@/hooks/useVisibleFacilityTypes", () => ({ useVisibleFacilityTypes: () => ({ facilityTypes: ["PCH"], isLoading: false }) }));
vi.mock("@/components/layout/MainLayout", () => ({ MainLayout: () => null }));
vi.mock("@/components/layout/KioskLayout", () => ({ KioskLayout: () => null }));

import { ProtectedRoute } from "./ProtectedRoute";

const Page = () => null;
function render(path: string, chrome: "default" | "kiosk" = "default") {
  vi.stubGlobal("window", { location: new URL(path, "https://app.test") });
  const layout = ProtectedRoute({ component: Page, chrome });
  return { layout, page: layout.props.children as ReactElement };
}

beforeEach(() => {
  h.user = { id: "reviewer-a", organizationId: "org-a", role: "org_admin" };
  h.viewingOrgId = null;
});
afterEach(() => vi.unstubAllGlobals());

describe("authenticated page state identity", () => {
  it.each(["employees", "schedules", "quizzes"])("starts fresh page state between %s resources without replacing the layout", resource => {
    const first = render(`/app/${resource}/a`);
    const second = render(`/app/${resource}/b`);
    expect(first.page.type).toBe(second.page.type);
    expect(first.page.key).not.toBe(second.page.key);
    expect(first.layout.type).toBe(second.layout.type);
    expect(first.layout.key).toBe(second.layout.key);
  });

  it("preserves page state for tab, filter and anchor changes on the same resource", () => {
    const first = render("/app/employees/a?tab=training#history");
    const second = render("/app/employees/a?tab=credentials#renewals");
    expect(second.page.key).toBe(first.page.key);
  });

  it.each(["id", "organizationId", "role"] as const)("starts fresh page state after the reviewer %s changes", field => {
    const first = render("/app/employees/a");
    h.user = { ...h.user, [field]: `${h.user[field]}-changed` };
    expect(render("/app/employees/a").page.key).not.toBe(first.page.key);
  });

  it("starts fresh state after a platform administrator changes the viewed organization", () => {
    h.user.role = "platform_admin";
    h.viewingOrgId = "org-a";
    const first = render("/admin/employees");
    h.viewingOrgId = "org-b";
    expect(render("/admin/employees").page.key).not.toBe(first.page.key);
  });

  it("isolates class state in kiosk chrome as well", () => {
    const first = render("/trainer/classes/a/kiosk", "kiosk");
    const second = render("/trainer/classes/b/kiosk", "kiosk");
    expect(second.page.key).not.toBe(first.page.key);
    expect(second.layout.type).toBe(first.layout.type);
  });
});
