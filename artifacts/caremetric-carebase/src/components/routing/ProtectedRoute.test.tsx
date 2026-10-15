import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "reviewer-a", organizationId: "org-a", role: "org_admin" },
  viewingOrgId: null as string | null,
  entitlementsFailed: false,
  sms: { isLoading: false, needsSms: false },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user, isLoading: false, isAuthenticated: true }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.viewingOrgId }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({ isLoading: false, isError: h.entitlementsFailed, refetch: vi.fn(), canAccessPath: () => true }) }));
vi.mock("@/hooks/useSessionNeedsSmsVerification", () => ({ useSessionNeedsSmsVerification: (enabled: boolean) => (enabled ? h.sms : { isLoading: false, needsSms: false }) }));
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
  h.entitlementsFailed = false;
  h.sms = { isLoading: false, needsSms: false };
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

describe("a session that still owes a text-message code", () => {
  function route(path: string) {
    vi.stubGlobal("window", { location: new URL(path, "https://app.test") });
    return ProtectedRoute({ component: Page }) as ReactElement<{ to?: string; children?: unknown }>;
  }

  it("is sent to account security with its page as next, not shown the entitlement error", () => {
    h.entitlementsFailed = true;
    h.sms = { isLoading: false, needsSms: true };
    expect(route("/app/incidents/abc?tab=forms#state").props.to)
      .toBe(`/account/security?next=${encodeURIComponent("/app/incidents/abc?tab=forms#state")}`);
  });

  it("can open account security even though its entitlement read failed", () => {
    h.entitlementsFailed = true;
    h.sms = { isLoading: false, needsSms: true };
    const layout = route("/account/security");
    expect((layout.props.children as ReactElement).type).toBe(Page);
  });

  it("still shows the entitlement error when the session is verified", () => {
    h.entitlementsFailed = true;
    expect(JSON.stringify(route("/app/today"))).toContain("Could not load your plan entitlements");
  });

  it("waits for the verification status instead of flashing the error", () => {
    h.entitlementsFailed = true;
    h.sms = { isLoading: true, needsSms: false };
    expect(JSON.stringify(route("/app/today"))).not.toContain("Could not load your plan entitlements");
    expect(route("/app/today").props.to).toBeUndefined();
  });
});
