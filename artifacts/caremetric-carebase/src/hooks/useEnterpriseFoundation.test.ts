import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), getSession: vi.fn(), invoke: vi.fn(), fetch: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useMutation: mocks.useMutation, useQuery: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke },
} }));

import { useCreateBillingSession, recoverBillingCheckout, type BillingSessionRequest } from "./useEnterpriseFoundation";
import { BillingSessionError, billingSessionFailureCopy } from "@/lib/billingErrors";

const request: BillingSessionRequest = {
  organizationId: "organization", action: "checkout", packageId: "package", billingInterval: "month",
  idempotencyKey: "checkout-idempotency-key",
};

function mutation() {
  useCreateBillingSession();
  return mocks.useMutation.mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_PROVIDER_RUNTIME", "railway");
  vi.stubEnv("BASE_URL", "/");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "current-user-session" } }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("billing provider runtime", () => {
  it("uses a closed GET-only recovery action without query caching and binds empty evidence to the requested organization", async () => {
    const result={kind:"checkout_recovery",targetId:"organization",preview:null,result:null,canStartNewCheckout:false};
    mocks.fetch.mockResolvedValueOnce(Response.json({data:result}));
    await expect(recoverBillingCheckout("organization","recovery-request")).resolves.toEqual(result);
    expect(mocks.useMutation).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/providers/create-billing-session",expect.objectContaining({
      body:JSON.stringify({action:"checkout_recover",organizationId:"organization",idempotencyKey:"recovery-request"}),
    }));
    for(const data of [{...result,targetId:"other"},{kind:"checkout_recovery",targetId:"organization",canStartNewCheckout:true}]) {
      mocks.fetch.mockResolvedValueOnce(Response.json({data}));
      await expect(recoverBillingCheckout("organization","recovery-request")).rejects.toBeInstanceOf(BillingSessionError);
    }
  });
  it("posts one checkout request to Railway with the original idempotency key and disables query retries", async () => {
    const response = { data: { kind: "checkout", sessionId: "session", url: "https://checkout.stripe.com/test-session" }, meta: { requestId: "request" } };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } }));
    const options = mutation();
    expect(options.retry).toBe(false);
    await expect(options.mutationFn(request)).resolves.toEqual(response);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/providers/create-billing-session", expect.objectContaining({
      method: "POST", body: JSON.stringify(request),
      headers: { "Content-Type": "application/json", Authorization: "Bearer current-user-session" },
    }));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("preserves billing's structured permission errors and UI action", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "aal2_required", message: "private provider detail" } }), {
      status: 403, headers: { "Content-Type": "application/json" },
    }));
    const error = await mutation().mutationFn(request).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BillingSessionError);
    expect(error.code).toBe("aal2_required");
    expect(billingSessionFailureCopy(error, "Checkout failed")).toMatchObject({
      actionPath: "/account/security", title: "Multi-factor authentication required",
    });
    expect(error.message).not.toContain("private provider detail");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("retains a generic billing failure for a non-JSON gateway error", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("<html>private gateway detail</html>", { status: 502 }));
    const error = await mutation().mutationFn(request).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BillingSessionError);
    expect(error.code).toBeNull();
    expect(error.message).not.toContain("private gateway detail");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("preserves the Supabase SDK path until Railway is explicitly selected", async () => {
    vi.stubEnv("VITE_PROVIDER_RUNTIME", undefined);
    mocks.invoke.mockResolvedValueOnce({ data: { data: { kind: "portal" } }, error: null });
    await expect(mutation().mutationFn({ organizationId: "organization", action: "portal" })).resolves.toEqual({ data: { kind: "portal" } });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("create-billing-session", { body: { organizationId: "organization", action: "portal" } });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
