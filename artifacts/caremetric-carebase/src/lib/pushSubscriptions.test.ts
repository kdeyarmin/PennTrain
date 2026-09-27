import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ invoke: vi.fn(), registration: vi.fn(), permission: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), getSubscription: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: h.invoke } } }));
import { disableWebPush, enableWebPush, getPushPermissionState, hasActiveWebPushSubscription } from "./pushSubscriptions";
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test-capability", toJSON: () => ({ endpoint: "test" }), unsubscribe: h.unsubscribe };
const registration = () => ({ active: {}, pushManager: { getSubscription: h.getSubscription, subscribe: h.subscribe } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { PushManager: {}, Notification: {} });
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: h.permission });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: h.registration, ready: new Promise(() => {}) } });
  h.registration.mockResolvedValue(registration()); h.getSubscription.mockResolvedValue(subscription);
  h.permission.mockResolvedValue("granted"); h.unsubscribe.mockResolvedValue(true); h.subscribe.mockResolvedValue(subscription);
  h.invoke.mockResolvedValue({ data: { active: true, publicKey: "AA" }, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("browser push readiness and account ownership", () => {
  it("reports unsupported browsers without accessing worker APIs", async () => {
    vi.stubGlobal("window", {});
    expect(getPushPermissionState()).toBe("unsupported");
    expect(await hasActiveWebPushSubscription()).toBe(false);
    await expect(enableWebPush()).rejects.toThrow("not supported");
    expect(h.registration).not.toHaveBeenCalled();
  });
  it("returns an actionable setup failure when no worker is installed instead of waiting forever", async () => {
    h.registration.mockResolvedValue(undefined);
    expect(await hasActiveWebPushSubscription()).toBe(false);
    await expect(enableWebPush()).rejects.toThrow("Reload the installed app");
    await disableWebPush(); expect(h.invoke).not.toHaveBeenCalled();
  });
  it("times out a worker that never activates", async () => {
    vi.useFakeTimers(); h.registration.mockResolvedValue({ ...registration(), active: null });
    const outcome = enableWebPush().then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await outcome).message).toContain("did not become ready");
    expect(h.invoke).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts readiness after an account switch without registering any endpoint", async () => {
    vi.useFakeTimers(); h.registration.mockResolvedValue({ ...registration(), active: null });
    const controller = new AbortController(); const outcome = enableWebPush(controller.signal).then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(1); controller.abort();
    expect((await outcome).name).toBe("AbortError");
    expect(h.invoke).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not report another account's browser endpoint as enabled for the current account", async () => {
    h.invoke.mockResolvedValue({ data: { active: false }, error: null });
    expect(await hasActiveWebPushSubscription()).toBe(false);
    expect(h.invoke).toHaveBeenCalledWith("push-subscriptions", expect.objectContaining({ method: "POST", body: { action: "status", endpoint: subscription.endpoint } }));
  });
  it("retains explicit Enable rebinding even when the browser already has a subscription", async () => {
    await enableWebPush();
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenNthCalledWith(2, "push-subscriptions", expect.objectContaining({ method: "POST", body: { subscription: subscription.toJSON() } }));
  });
  it("propagates status read errors instead of claiming a confirmed subscription", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new Error("Status unavailable") });
    await expect(hasActiveWebPushSubscription()).rejects.toThrow("Status unavailable");
  });
  it("does not unsubscribe a reused browser endpoint after Disable is canceled during its server request", async () => {
    const remove = deferred<{ error: null }>(); h.invoke.mockReturnValueOnce(remove.promise);
    const controller = new AbortController(); const outcome = disableWebPush(controller.signal).then(() => null, error => error);
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledOnce());
    controller.abort(); remove.resolve({ error: null });
    expect((await outcome).name).toBe("AbortError"); expect(h.unsubscribe).not.toHaveBeenCalled();
  });
  it("retains a newly created endpoint reused by a newer account when canceled registration settles late", async () => {
    const save = deferred<{ error: Error }>(); h.getSubscription.mockResolvedValueOnce(null);
    h.invoke.mockResolvedValueOnce({ data: { publicKey: "AA" }, error: null }).mockReturnValueOnce(save.promise);
    const controller = new AbortController(); const outcome = enableWebPush(controller.signal).then(() => null, error => error);
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
    controller.abort(); await enableWebPush();
    save.resolve({ error: new DOMException("Canceled", "AbortError") });
    expect((await outcome).name).toBe("AbortError"); expect(h.unsubscribe).not.toHaveBeenCalled();
  });
  it("still cleans up a newly created subscription after an ordinary registration failure", async () => {
    h.getSubscription.mockResolvedValueOnce(null);
    h.invoke.mockResolvedValueOnce({ data: { publicKey: "AA" }, error: null }).mockResolvedValueOnce({ error: new Error("Registration refused") });
    await expect(enableWebPush()).rejects.toThrow("Registration refused");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});
