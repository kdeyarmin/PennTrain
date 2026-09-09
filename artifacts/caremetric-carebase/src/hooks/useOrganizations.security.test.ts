import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(), maybeSingle: vi.fn(), getMfaStatus: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) } }));
vi.mock("@/lib/mfaSecurity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mfaSecurity")>(), getMfaStatus: mocks.getMfaStatus,
}));

import { useMyOrganizationAccessible } from "./useOrganizations";

const execute = () => {
  useMyOrganizationAccessible("org", true);
  return mocks.useQuery.mock.calls.at(-1)![0].queryFn();
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
});

describe("organization access before SMS verification", () => {
  it("defers the suspension screen when the unverified SMS session cannot read its organization", async () => {
    mocks.getMfaStatus.mockResolvedValue({ smsRequired: true, verified: false, expiresAt: null });
    await expect(execute()).resolves.toBeNull();
  });

  it("defers an explicit PostgREST SMS denial without repeatedly retrying a normal sign-in", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501", hint: "mfa_required" } });
    mocks.getMfaStatus.mockResolvedValue({ smsRequired: true, verified: false, expiresAt: null });
    await expect(execute()).resolves.toBeNull();
  });

  it("shows unavailable organization access before SMS when the account is suspended or canceled", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501", hint: "mfa_required" } });
    mocks.getMfaStatus.mockResolvedValue({ accountAccessible: false, smsRequired: true, verified: false, expiresAt: null });
    await expect(execute()).resolves.toBe(false);
  });

  it("does not diagnose suspension from an SMS denial when the session now reports verified", async () => {
    const denied = { code: "42501", hint: "mfa_required" };
    mocks.maybeSingle.mockResolvedValue({ data: null, error: denied });
    mocks.getMfaStatus.mockResolvedValue({ smsRequired: true, verified: true, expiresAt: "2099-01-01T00:00:00Z" });
    await expect(execute()).rejects.toBe(denied);
  });

  it("still identifies an inaccessible organization after the SMS session is verified", async () => {
    mocks.getMfaStatus.mockResolvedValue({ smsRequired: true, verified: true, expiresAt: "2099-01-01T00:00:00Z" });
    await expect(execute()).resolves.toBe(false);
  });

  it("does not diagnose suspension from an unavailable security service", async () => {
    mocks.getMfaStatus.mockRejectedValue(new Error("security status unavailable"));
    await expect(execute()).rejects.toThrow("security status unavailable");
  });

  it("accepts an accessible organization without an extra security round trip", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "org" }, error: null });
    await expect(execute()).resolves.toBe(true);
    expect(mocks.getMfaStatus).not.toHaveBeenCalled();
  });
});
