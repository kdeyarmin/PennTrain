import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(), invoke: vi.fn(), setSession: vi.fn(), signOut: vi.fn(),
  getSession: vi.fn(), verifyOtp: vi.fn(), clear: vi.fn(), dispatchEvent: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useMutation: mocks.useMutation }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { clear: mocks.clear } }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  functions: { invoke: mocks.invoke },
  auth: { setSession: mocks.setSession, signOut: mocks.signOut, getSession: mocks.getSession, verifyOtp: mocks.verifyOtp },
} }));

import { STORAGE_KEY, useStartImpersonation, useStopImpersonation } from "./useImpersonation";

const originSession = { access_token: "operator-token", refresh_token: "operator-refresh" };
const target = { id: "target", email: "target@example.test", firstName: "Test", lastName: "Target", role: "employee", organizationId: "org" };
const record = { originSession, target, impersonationId: "context", contextSecret: "context-secret", startedAt: "2026-09-08T12:00:00Z" };
const mutation = () => mocks.useMutation.mock.calls.at(-1)![0].mutationFn;

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", { dispatchEvent: mocks.dispatchEvent });
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  mocks.invoke.mockResolvedValue({ error: null });
  mocks.setSession.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("impersonation exit", () => {
  it("retries restoring the operator after revocation without ending the revoked session again", async () => {
    mocks.setSession.mockResolvedValueOnce({ error: new Error("temporary restore failure") });
    useStopImpersonation();
    await expect(mutation()()).rejects.toThrow("temporary restore failure");
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({ ended: true, originSession });

    await expect(mutation()()).resolves.toEqual(target);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.setSession).toHaveBeenCalledTimes(2);
    expect(mocks.setSession).toHaveBeenLastCalledWith(originSession);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mocks.clear).toHaveBeenCalledOnce();
  });

  it("does not restore or forget the live context when revocation fails", async () => {
    mocks.invoke.mockResolvedValue({ error: new Error("revocation failed") });
    useStopImpersonation();
    await expect(mutation()()).rejects.toThrow("revocation failed");
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual(record);
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("persists the server deadline so the auto-return uses the actual authorization window", async () => {
    const expiresAt = "2026-09-08T12:29:45Z";
    mocks.getSession.mockResolvedValue({ data: { session: originSession } });
    mocks.invoke.mockResolvedValueOnce({ data: {
      session: { access_token: "bound-target-token", refresh_token: "bound-target-refresh" },
      target, impersonation_id: "context", context_secret: "context-secret", expires_at: expiresAt,
    }, error: null });
    useStartImpersonation();
    await mutation()({ targetUserId: target.id, reason: "support ticket" });
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({ expiresAt, originSession });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("impersonate-user", {
      body: { action: "start_bound", target_user_id: target.id, reason: "support ticket" },
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: "bound-target-token", refresh_token: "bound-target-refresh" });
  });

  it("keeps the operator session when an older edge deployment rejects start_bound", async () => {
    sessionStorage.removeItem(STORAGE_KEY);
    mocks.getSession.mockResolvedValue({ data: { session: originSession } });
    mocks.invoke.mockResolvedValueOnce({ error: new Error("action must be one of start, bind, end") });
    useStartImpersonation();

    await expect(mutation()({ targetUserId: target.id, reason: "support ticket" }))
      .rejects.toThrow("action must be one of start, bind, end");
    expect(mocks.invoke).toHaveBeenCalledWith("impersonate-user", {
      body: { action: "start_bound", target_user_id: target.id, reason: "support ticket" },
    });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.dispatchEvent).not.toHaveBeenCalled();
  });

  it("never redeems an unbound magic-link response or changes the operator session", async () => {
    sessionStorage.removeItem(STORAGE_KEY);
    mocks.getSession.mockResolvedValue({ data: { session: originSession } });
    mocks.invoke.mockResolvedValueOnce({ data: {
      token_hash: "legacy-unbound-hash", target, impersonation_id: "context", context_secret: "context-secret",
    }, error: null });
    useStartImpersonation();

    await expect(mutation()({ targetUserId: target.id, reason: "support ticket" }))
      .rejects.toThrow("incomplete session response");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.dispatchEvent).not.toHaveBeenCalled();
  });
});
