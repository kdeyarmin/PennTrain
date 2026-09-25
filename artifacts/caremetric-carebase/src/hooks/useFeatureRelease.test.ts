import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useQuery: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));

import { useFeatureReleaseActive, useOrgFeatureEnabled } from "./useFeatureRelease";

type QueryOptions = { queryKey: unknown[]; enabled: boolean; queryFn: () => Promise<boolean> };
function query() { return mocks.useQuery.mock.calls.at(-1)![0] as QueryOptions; }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.useAuth.mockReturnValue({
    user: { id: "admin-a", role: "org_admin", organizationId: "org-a" },
    isAuthenticated: true, isLoading: false,
  });
  mocks.useQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("organization feature query scope", () => {
  it.each([null, "org-a"])("does not ask a tenant-only RPC for a platform administrator (organization %s)", async (organizationId) => {
    mocks.useAuth.mockReturnValue({
      user: { id: "platform-admin", role: "platform_admin", organizationId },
      isAuthenticated: true, isLoading: false,
    });
    // Even a stale result cannot manufacture a tenant entitlement for this role.
    mocks.useQuery.mockReturnValue({ data: true, isLoading: false, isError: false });
    expect(useOrgFeatureEnabled("survey_day_mode").isEnabled).toBe(false);
    expect(query().enabled).toBe(false);
    expect(await query().queryFn()).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { user: null, isAuthenticated: false, isLoading: false },
    { user: null, isAuthenticated: false, isLoading: true },
    { user: { id: "pending", role: "org_admin", organizationId: null }, isAuthenticated: true, isLoading: false },
    { user: { id: "pending", role: "org_admin", organizationId: "org-a" }, isAuthenticated: true, isLoading: true },
  ])("waits for an authenticated organization scope: %j", async (auth) => {
    mocks.useAuth.mockReturnValue(auth);
    expect(useOrgFeatureEnabled("survey_day_mode").isEnabled).toBe(false);
    expect(query().enabled).toBe(false);
    expect(await query().queryFn()).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still evaluates tenant features through the server", async () => {
    useOrgFeatureEnabled("survey_day_mode");
    expect(query().enabled).toBe(true);
    expect(await query().queryFn()).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("org_feature_enabled", { p_feature_key: "survey_day_mode" });
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await query().queryFn()).toBe(false);
  });

  it("preserves real tenant query failures instead of hiding them", async () => {
    const error = new Error("Entitlement service unavailable");
    mocks.rpc.mockResolvedValueOnce({ data: null, error });
    useOrgFeatureEnabled("survey_day_mode");
    await expect(query().queryFn()).rejects.toBe(error);
  });

  it("does not reuse another caller or organization's feature result", () => {
    useOrgFeatureEnabled("survey_day_mode");
    const first = query().queryKey;
    mocks.useAuth.mockReturnValue({
      user: { id: "admin-b", role: "org_admin", organizationId: "org-b" },
      isAuthenticated: true, isLoading: false,
    });
    useOrgFeatureEnabled("survey_day_mode");
    expect(query().queryKey).not.toEqual(first);
    expect(query().queryKey).toEqual(["org_feature_enabled", "admin-b", "org-b", "survey_day_mode"]);
  });
});

describe("feature decisions after a failed refetch", () => {
  it.each([
    { name: "release", read: () => useFeatureReleaseActive("survey_day_mode").isActive },
    { name: "organization entitlement", read: () => useOrgFeatureEnabled("survey_day_mode").isEnabled },
  ])("withdraws the cached $name allowance when its refetch fails", async ({ read }) => {
    // Use real cache state: a failed refetch keeps data:true but sets isError.
    const { QueryClient, QueryObserver } = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["feature-refetch-regression"];
    client.setQueryData(key, true);
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => { throw new Error("Feature evaluation unavailable"); },
      retry: false,
    });
    mocks.useQuery.mockReturnValue(observer.getCurrentResult());
    expect(read()).toBe(true);

    const failed = await observer.refetch();
    expect(failed.data).toBe(true);
    expect(failed.isError).toBe(true);
    mocks.useQuery.mockReturnValue(failed);
    expect(read()).toBe(false);
    observer.destroy();
    client.clear();
  });
});
