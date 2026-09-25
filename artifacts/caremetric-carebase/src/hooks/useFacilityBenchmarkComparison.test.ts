import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useQuery: vi.fn(), useOrgFeatureEnabled: vi.fn(), useListMyFacilityAssignments: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/useFeatureRelease", () => ({ useOrgFeatureEnabled: mocks.useOrgFeatureEnabled }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useListMyFacilityAssignments: mocks.useListMyFacilityAssignments }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));

import { useFacilityBenchmarkComparison } from "./useFacilityBenchmarkComparison";

type QueryOptions = { queryKey: unknown[]; enabled: boolean; queryFn: () => Promise<{ available: boolean }> };
function query() { return mocks.useQuery.mock.calls.at(-1)![0] as QueryOptions; }
const facilities = [{ facilityId: "facility-a", facilityName: "Aspen", isActive: true }];
function setRole(role: string, overrides = {}) {
  mocks.useAuth.mockReturnValue({
    user: { id: "admin-a", role, organizationId: role === "platform_admin" ? null : "org-a" },
    isAuthenticated: true, isLoading: false, ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  setRole("org_admin");
  mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: false });
  mocks.useListMyFacilityAssignments.mockReturnValue({ data: [{ facility_id: "facility-a" }], isPending: false, isError: false });
  mocks.useQuery.mockReturnValue({ data: undefined });
  mocks.rpc.mockResolvedValue({ data: { available: true }, error: null });
});

describe("dashboard benchmark access", () => {
  it.each([
    { isEnabled: false, isLoading: true },
    { isEnabled: false, isError: true },
    { isEnabled: false, data: false },
  ])("does not request unreleased benchmarks while the entitlement is %j", async (feature) => {
    mocks.useOrgFeatureEnabled.mockReturnValue(feature);
    useFacilityBenchmarkComparison(facilities);
    expect(mocks.useOrgFeatureEnabled).toHaveBeenCalledWith("analytics.cross_tenant_benchmarks");
    expect(query().enabled).toBe(false);
    expect(await query().queryFn()).toEqual({ available: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["org_admin", "facility_manager", "auditor"])("loads released benchmarks for %s", async (role) => {
    setRole(role);
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    useFacilityBenchmarkComparison(facilities);
    expect(query().enabled).toBe(true);
    expect(await query().queryFn()).toEqual({ available: true });
    expect(mocks.rpc).toHaveBeenCalledWith("get_facility_benchmark_comparison", { p_facility_id: "facility-a" });
  });

  it("preserves the database's platform administrator bypass without a tenant entitlement", async () => {
    setRole("platform_admin");
    useFacilityBenchmarkComparison(facilities);
    expect(query().enabled).toBe(true);
    expect(await query().queryFn()).toEqual({ available: true });
  });

  it.each(["employee", "trainer"])("does not let an enabled feature grant %s benchmark access", async (role) => {
    setRole(role);
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    useFacilityBenchmarkComparison(facilities);
    expect(query().enabled).toBe(false);
    await query().queryFn();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { isAuthenticated: false },
    { isLoading: true },
  ])("waits for a settled authenticated session: %j", async (auth) => {
    setRole("platform_admin", auth);
    useFacilityBenchmarkComparison(facilities);
    expect(query().enabled).toBe(false);
    await query().queryFn();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not request benchmarks until the dashboard has a visible facility", async () => {
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    useFacilityBenchmarkComparison([]);
    expect(query().enabled).toBe(false);
    await query().queryFn();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("hides cached benchmarks when their entitlement is withdrawn", () => {
    mocks.useQuery.mockReturnValue({ data: { available: true } });
    expect(useFacilityBenchmarkComparison(facilities).data).toBeUndefined();
  });

  it("separates cached benchmark data when callers change", () => {
    useFacilityBenchmarkComparison(facilities);
    const firstKey = query().queryKey;
    mocks.useAuth.mockReturnValue({
      user: { id: "admin-b", role: "org_admin", organizationId: "org-b" },
      isAuthenticated: true, isLoading: false,
    });
    useFacilityBenchmarkComparison(facilities);
    expect(query().queryKey).not.toEqual(firstKey);
  });

  it("keeps optional benchmarks unavailable if the server rejects or cannot serve them", async () => {
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    useFacilityBenchmarkComparison(facilities);
    expect(await query().queryFn()).toEqual({ available: false });
  });

  it("uses the manager's assigned facility when the organization summary starts with another site", async () => {
    setRole("facility_manager");
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    mocks.useListMyFacilityAssignments.mockReturnValue({ data: [{ facility_id: "facility-c" }], isPending: false, isError: false });
    const cedar = { facilityId: "facility-c", facilityName: "Cedar", isActive: true };
    const result = useFacilityBenchmarkComparison([...facilities, cedar]);
    expect(result.facility).toBe(cedar);
    expect(query().enabled).toBe(true);
    await query().queryFn();
    expect(mocks.rpc).toHaveBeenCalledWith("get_facility_benchmark_comparison", { p_facility_id: "facility-c" });
  });

  it("skips an inactive manager facility even when an assignment remains", async () => {
    setRole("facility_manager");
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    mocks.useListMyFacilityAssignments.mockReturnValue({
      data: [{ facility_id: "facility-a" }, { facility_id: "facility-c" }], isPending: false, isError: false,
    });
    const inactiveAspen = { ...facilities[0], isActive: false };
    const cedar = { facilityId: "facility-c", facilityName: "Cedar", isActive: true };
    expect(useFacilityBenchmarkComparison([inactiveAspen, cedar]).facility).toBe(cedar);
    await query().queryFn();
    expect(mocks.rpc).toHaveBeenCalledWith("get_facility_benchmark_comparison", { p_facility_id: "facility-c" });
    mocks.rpc.mockClear();
    expect(useFacilityBenchmarkComparison([inactiveAspen]).facility).toBeUndefined();
    expect(query().enabled).toBe(false);
    await query().queryFn();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: undefined, isPending: true, isError: false },
    { data: [{ facility_id: "facility-a" }], isPending: false, isError: true },
    { data: [], isPending: false, isError: false },
  ])("does not request a manager benchmark without confirmed facility access: %j", async (assignments) => {
    setRole("facility_manager");
    mocks.useOrgFeatureEnabled.mockReturnValue({ isEnabled: true });
    mocks.useListMyFacilityAssignments.mockReturnValue(assignments);
    expect(useFacilityBenchmarkComparison(facilities).facility).toBeUndefined();
    expect(query().enabled).toBe(false);
    await query().queryFn();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
