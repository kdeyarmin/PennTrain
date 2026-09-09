import { FunctionsHttpError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn(), fetch: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: {
  auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke },
} }));

import { invokeProviderFunction } from "./providerFunctions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_PROVIDER_RUNTIME", "railway");
  vi.stubEnv("BASE_URL", "/");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "current-user-session" } }, error: null });
  mocks.fetch.mockImplementation(async () => json({ smsAvailable: true }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("provider runtime selection", () => {
  it.each([undefined, "supabase"])("preserves SDK invocation when the runtime is %s", async (runtime) => {
    vi.stubEnv("VITE_PROVIDER_RUNTIME", runtime);
    const result = { data: { verified: true }, error: null };
    mocks.invoke.mockResolvedValueOnce(result);
    await expect(invokeProviderFunction("sms-mfa", { body: { action: "status" } })).resolves.toBe(result);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("sms-mfa", { body: { action: "status" } });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["", "Railway", " railway", "https://example.com", "invalid"])("fails closed for runtime %s", async (runtime) => {
    vi.stubEnv("VITE_PROVIDER_RUNTIME", runtime);
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("not configured correctly");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["stripe-billing-webhook", "sms-mfa/other", "../sms-mfa", "https://example.com"])("refuses unsupported function %s", async (name) => {
    const result = await invokeProviderFunction(name as "sms-mfa", { body: {} });
    expect(result.error?.message).toContain("not supported");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/", "//example.com/", "./", "", "/app", "/../", "/%2f/", "/\\example.com/", "/app/?redirect="])("refuses a base that could change or obscure the request destination: %s", async (base) => {
    vi.stubEnv("BASE_URL", base);
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    expect(result.error?.message).toContain("not configured correctly");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});

describe("authenticated same-origin provider requests", () => {
  it.each([
    ["/", "sms-mfa", "/api/providers/sms-mfa"],
    ["/caremetric/app/", "create-billing-session", "/caremetric/app/api/providers/create-billing-session"],
  ] as const)("posts under base %s to exact function %s", async (base, name, path) => {
    vi.stubEnv("BASE_URL", base);
    const body = { action: "status" };
    await expect(invokeProviderFunction(name, { body })).resolves.toEqual({ data: { smsAvailable: true }, error: null });
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(path, {
      method: "POST", body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: "Bearer current-user-session" },
      credentials: "omit", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reads the current session for each request instead of retaining an earlier user's token", async () => {
    await invokeProviderFunction("sms-mfa", { body: { action: "status" } });
    mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: "new-user-session" } }, error: null });
    await invokeProviderFunction("sms-mfa", { body: { action: "status" } });
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new-user-session");
  });

  it.each([null, {}, { access_token: "" }, { access_token: " " }])("never posts anonymously when the session is %s", async (session) => {
    mocks.getSession.mockResolvedValueOnce({ data: { session }, error: null });
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    expect(result).toMatchObject({ data: null, error: { message: "Sign in again to continue." } });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects an auth error even if the auth result also carries a token", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: "do-not-send" } }, error: new Error("private auth details") });
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    expect(result.error?.message).toBe("Sign in again to continue.");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("provider error compatibility", () => {
  it.each([
    [{ code: "fresh_password_required", error: "private provider body", phone: "+15551234567" }, { code: "fresh_password_required" }],
    [{ error: { code: "aal2_required", message: "private provider body" }, requestId: "private-request" }, { error: { code: "aal2_required" } }],
  ])("retains only application error codes and HTTP status", async (body, safe) => {
    mocks.fetch.mockResolvedValueOnce(json(body, 403));
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(FunctionsHttpError);
    const error = result.error as FunctionsHttpError;
    expect(error.context.status).toBe(403);
    await expect(error.context.json()).resolves.toEqual(safe);
    expect(error.message).not.toContain("private");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not preserve arbitrary strings disguised as codes", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ code: "private token: 123", error: { code: "a".repeat(97) } }, 502));
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "status" } });
    await expect((result.error as FunctionsHttpError).context.json()).resolves.toEqual({});
  });

  it("keeps a non-JSON HTTP failure generic without falling back to Supabase", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("<html>private gateway details</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
    const result = await invokeProviderFunction("create-billing-session", { body: { action: "checkout" } });
    expect(result.error).toBeInstanceOf(FunctionsHttpError);
    expect((result.error as FunctionsHttpError).context.status).toBe(502);
    await expect((result.error as FunctionsHttpError).context.json()).resolves.toEqual({});
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response("<html>SPA fallback</html>", { headers: { "Content-Type": "text/html" } }),
    () => new Response("not json", { headers: { "Content-Type": "application/json" } }),
    () => json(null), () => json([]), () => json("private details"),
    () => json({ data: "a".repeat(64 * 1024) }),
  ])("rejects an invalid or oversized success response", async (response) => {
    mocks.fetch.mockResolvedValueOnce(response());
    const result = await invokeProviderFunction("sms-mfa", { body: { action: "verify" } });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("could not be confirmed");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("sanitizes rejected fetch errors and never retries an ambiguous mutation", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("private provider details with current-user-session"));
    const result = await invokeProviderFunction("create-billing-session", { body: { action: "checkout" } });
    expect(result.error?.message).toContain("could not be confirmed");
    expect(result.error?.message).not.toContain("private");
    expect(result.error?.message).not.toContain("current-user-session");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("provider request deadline", () => {
  it("aborts an unconfirmed request once without retrying or changing runtime", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    expect(result.error?.message).toContain("could not be confirmed");
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not post later if session acquisition finishes after the deadline", async () => {
    vi.useFakeTimers();
    let resolveSession!: (value: unknown) => void;
    mocks.getSession.mockImplementationOnce(() => new Promise((resolve) => { resolveSession = resolve; }));
    const pending = invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).error?.message).toContain("could not be confirmed");
    resolveSession({ data: { session: { access_token: "too-late-session" } }, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("includes a stalled response body in the same request deadline", async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { streamController = controller; } }), {
      headers: { "Content-Type": "application/json" },
    }));
    const pending = invokeProviderFunction("sms-mfa", { body: { action: "send" } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).error?.message).toContain("could not be confirmed");
    streamController.close();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
