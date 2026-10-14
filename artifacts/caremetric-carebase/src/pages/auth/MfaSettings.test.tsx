import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0,
  effects: [] as (() => void | (() => void))[], authEvent: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void),
  load: vi.fn(), unenroll: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), clear: vi.fn(), toast: vi.fn(),
  enroll: vi.fn(), verify: vi.fn(), invalidate: vi.fn(), send: vi.fn(), verifySms: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.states)) h.states[i] = initial;
    return [h.states[i], (next: unknown) => { h.states[i] = typeof next === "function" ? next(h.states[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
  useMemo: (compute: () => unknown) => compute(), useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/account/security", vi.fn()], useSearch: () => "" }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "current" } }), clearLocalSessionState: h.clear }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {
  refreshSession: h.refresh, signOut: h.signOut, getSession: h.getSession,
  mfa: { unenroll: h.unenroll, enroll: h.enroll, challengeAndVerify: h.verify },
  onAuthStateChange: (callback: typeof h.authEvent) => { h.authEvent = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
} } }));
vi.mock("@/lib/mfaSecurity", async original => ({ ...await original<typeof import("@/lib/mfaSecurity")>(),
  loadMfaSecurityState: h.load, invalidateMfaDependentQueries: h.invalidate,
  sendSmsMfaCode: h.send, verifySmsMfaCode: h.verifySms,
}));
import MfaSettings from "./MfaSettings";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; h.refCursor = 0; h.effects = []; return nodes(MfaSettings()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
let cleanups: (() => void)[];
async function mount() { render(); cleanups = h.effects.map(effect => effect()).filter((fn): fn is () => void => typeof fn === "function"); await flush(); }
function remove() { const button = render().find(node => String(node.props["aria-label"]).startsWith("Remove "))!; (button.props.onClick as () => void)(); }
const smsReady = {
  status: { verified: false, method: null, verifiedAt: null, expiresAt: null, hasVerifiedFactor: true, smsRequired: true,
    smsFactors: [{ id: "sms-factor", maskedPhone: "••• ••• 4567", createdAt: "2026-09-26T12:00:00Z" }] },
  factors: [{ id: "sms-factor", factor_type: "sms", status: "verified", friendly_name: "••• ••• 4567", created_at: "2026-09-26T12:00:00Z", phone: null }],
  smsAvailable: true,
};
function click(label: string) { const button = render().find(node => node.props.onClick && text(node.props.children as ReactNode) === label)!; (button.props.onClick as () => void)(); }
const ready = {
  status: { verified: false, method: null, verifiedAt: null, expiresAt: null, hasVerifiedFactor: true, smsRequired: false, smsFactors: [] },
  factors: [{ id: "factor", factor_type: "totp", status: "verified", friendly_name: "Authenticator", created_at: "2026-09-26T12:00:00Z" }], smsAvailable: false,
};
beforeEach(() => {
  vi.clearAllMocks(); h.states = []; h.refs = []; h.authEvent = undefined; cleanups = [];
  h.load.mockResolvedValue(ready); h.unenroll.mockResolvedValue({ error: null });
  h.refresh.mockResolvedValue({ error: null }); h.signOut.mockResolvedValue({ error: null });
  h.getSession.mockResolvedValue({ data: { session: null }, error: null });
  h.clear.mockResolvedValue(undefined); h.invalidate.mockResolvedValue(undefined);
});

describe("account security request ownership", () => {
  it("does not refresh or sign out after factor removal finishes on an abandoned page", async () => {
    await mount(); const pending = deferred<{ error: null }>(); h.unenroll.mockReturnValueOnce(pending.promise);
    remove(); cleanups.forEach(cleanup => cleanup()); pending.resolve({ error: null }); await flush();
    expect(h.refresh).not.toHaveBeenCalled(); expect(h.signOut).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });

  it("does not sign out a replacement account when the former refresh fails before React remounts", async () => {
    await mount(); const pending = deferred<{ error: Error }>(); h.refresh.mockReturnValueOnce(pending.promise);
    remove(); await flush();
    h.authEvent?.("SIGNED_IN", { user: { id: "replacement" } });
    pending.resolve({ error: new Error("Old session expired") }); await flush();
    expect(h.signOut).not.toHaveBeenCalled(); expect(h.clear).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });

  it("retains the current-account recovery when assurance cannot be refreshed", async () => {
    await mount(); h.refresh.mockResolvedValueOnce({ error: new Error("Refresh failed") }); remove(); await flush();
    expect(h.signOut).toHaveBeenCalledOnce(); expect(h.clear).toHaveBeenCalledOnce();
  });

  it("does not erase a new account's local state after an older sign-out returns", async () => {
    await mount(); h.refresh.mockResolvedValueOnce({ error: new Error("Refresh failed") });
    const pending = deferred<{ error: null }>(); h.signOut.mockReturnValueOnce(pending.promise);
    remove(); await flush();
    h.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "replacement" } } }, error: null });
    pending.resolve({ error: null }); await flush();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("never offers an authenticator app, and a leftover one can only be removed", async () => {
    await mount();
    const page = render(); const labels = page.map(node => text(node.props.children as ReactNode)).join("|");
    expect(labels).not.toMatch(/authenticator/i); expect(page.some(node => node.type === "img")).toBe(false);
    expect(labels).toContain("Older verification method"); expect(labels).toContain("Not in use");
    expect(page.some(node => node.props.onClick && text(node.props.children as ReactNode) === "Text me a code")).toBe(false);
    expect(page.some(node => String(node.props["aria-label"]).startsWith("Remove "))).toBe(true);
    expect(h.enroll).not.toHaveBeenCalled(); expect(h.verify).not.toHaveBeenCalled();
  });

  it("does not publish a texted enrollment or feedback after the account changes", async () => {
    h.load.mockResolvedValue({ ...smsReady, status: { ...smsReady.status, hasVerifiedFactor: false, smsRequired: false, smsFactors: [] }, factors: [] });
    await mount(); click("Add text message (SMS)");
    const phone = render().find(node => node.props.id === "mfa-phone")!;
    (phone.props.onChange as (event: unknown) => void)({ target: { value: "(555) 123-4567" } });
    const pending = deferred<unknown>(); h.send.mockReturnValueOnce(pending.promise);
    const form = render().find(node => node.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    expect(h.send).toHaveBeenCalledWith("+15551234567");
    h.authEvent?.("SIGNED_IN", { user: { id: "replacement" } });
    pending.resolve({ challengeId: "old-challenge", maskedPhone: "••• ••• 4567", expiresAt: "2099-01-01T00:00:00Z" }); await flush();
    expect(JSON.stringify(h.states)).not.toContain("old-challenge"); expect(h.toast).not.toHaveBeenCalled();
  });

  it("stops a completed old verification before refreshing the replacement session", async () => {
    h.load.mockResolvedValue(smsReady);
    h.send.mockResolvedValue({ challengeId: "sms-challenge", maskedPhone: "••• ••• 4567", expiresAt: "2099-01-01T00:00:00Z" });
    await mount(); click("Text me a code"); await flush(); h.toast.mockClear();
    const input = render().find(node => node.props.id === "mfa-code")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "123456" } });
    const pending = deferred<void>(); h.verifySms.mockReturnValueOnce(pending.promise);
    const form = render().find(node => node.type === "form" && nodes(node.props.children as ReactNode).some(child => child.props.id === "mfa-code"))!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    expect(h.verifySms).toHaveBeenCalledWith("sms-challenge", "123456");
    h.authEvent?.("SIGNED_IN", { user: { id: "replacement" } });
    pending.resolve(); await flush();
    expect(h.refresh).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });

  it("preserves successful current-account factor removal and refreshed feedback", async () => {
    await mount(); remove(); await flush();
    expect(h.refresh).toHaveBeenCalledOnce(); expect(h.invalidate).toHaveBeenCalledOnce();
    expect(h.toast).toHaveBeenCalledWith({ title: "Factor removed" }); expect(h.signOut).not.toHaveBeenCalled();
  });

  it("ignores an obsolete status failure after a later retry succeeds", async () => {
    h.load.mockResolvedValueOnce({ ...ready, status: { ...ready.status, smsRequired: true } });
    await mount();
    const retry = render().find(node => node.props.onClick && text(node.props.children as ReactNode) === "Retry")!;
    let fail!: (reason: Error) => void;
    h.load.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    (retry.props.onClick as () => void)();
    h.load.mockResolvedValueOnce(ready); (retry.props.onClick as () => void)(); await flush();
    fail(new Error("Obsolete read failed")); await flush();
    expect(h.states[2]).toEqual(ready.status); expect(h.states[3]).toBe(null);
    expect(h.toast).not.toHaveBeenCalled();
  });
});
