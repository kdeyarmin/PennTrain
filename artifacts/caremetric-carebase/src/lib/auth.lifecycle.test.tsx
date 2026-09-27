import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Session = { access_token: string; user: { id: string } } | null;
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0,
  effects: [] as (() => void | (() => void))[], listener: undefined as ((event: string, session: Session) => void) | undefined,
  getSession: vi.fn(), signIn: vi.fn(), clear: vi.fn(), invalidate: vi.fn(), runtimeClear: vi.fn(), toast: vi.fn(), unsubscribe: vi.fn(),
  scope: undefined as string[] | null | undefined, primary: "home" as string | null | undefined,
  role: "employee", org: "org",
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.state)) h.state[i] = initial;
    return [h.state[i], (value: unknown) => { h.state[i] = typeof value === "function" ? value(h.state[i]) : value; }];
  },
  useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: h.clear, invalidateQueries: h.invalidate }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "profile" && queryKey[1] ? {
      id: queryKey[1], first_name: "Test", last_name: "User", email: "test@example.test",
      role: h.role, organization_id: h.org, is_active: true,
    } : queryKey[0] === "profile-facility" ? (queryKey[1] === "scope" ? h.scope : h.primary) : null,
    isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("./queryClient", () => ({ queryClient: { clear: h.clear } }));
vi.mock("@/hooks/useImpersonation", () => ({ STORAGE_KEY: "impersonation", CHANGE_EVENT: "impersonation-change", useStopImpersonation: vi.fn() }));
vi.mock("@/lib/offlineServiceDraftCache", () => ({ wipeOfflineServiceDrafts: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./supabase", () => ({
  clearSupabaseRuntimeCache: h.runtimeClear,
  supabase: { auth: {
    getSession: h.getSession,
    signInWithPassword: h.signIn,
    onAuthStateChange: (listener: typeof h.listener) => {
      h.listener = listener;
      return { data: { subscription: { unsubscribe: h.unsubscribe } } };
    },
  } },
}));

describe("AuthProvider session lifecycle", () => {
  let AuthProvider: typeof import("./auth").AuthProvider;
  let markIdleUnlockSignIn: typeof import("./auth").markIdleUnlockSignIn;
  let signInWithPassword: typeof import("./auth").signInWithPassword;
  let cleanup: (() => void) | void;
  const original = { access_token: "session-a", user: { id: "account-a" } };
  function render() {
    h.cursor = 0; h.refCursor = 0; h.effects = [];
    return AuthProvider({ children: null }) as ReactElement<{ value: { user: { id: string } | null; isLoading: boolean; isAuthenticated: boolean; offlineFacilityScope?: import("./offlineServiceDraftCache").OfflineFloorFacilityScope } }>;
  }
  async function mount() { render(); cleanup = h.effects[0](); await Promise.resolve(); }
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    h.state = []; h.refs = []; h.effects = []; h.listener = undefined; cleanup = undefined;
    h.scope = undefined; h.primary = "home"; h.role = "employee"; h.org = "org";
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
    };
    vi.stubGlobal("window", { location: { hash: "", pathname: "/app", search: "" }, localStorage: storage, dispatchEvent: vi.fn() });
    vi.stubGlobal("sessionStorage", storage);
    h.getSession.mockResolvedValue({ data: { session: original }, error: null });
    h.invalidate.mockResolvedValue(undefined); h.runtimeClear.mockResolvedValue(undefined);
    ({ AuthProvider, markIdleUnlockSignIn, signInWithPassword } = await import("./auth"));
  });
  afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

  it("preserves cached work when refocusing re-announces the same session", async () => {
    await mount();
    h.listener!("SIGNED_IN", { ...original });
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.runtimeClear).not.toHaveBeenCalled();
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["profile"] });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["profile-facility"] });
    expect(render().props.value.isAuthenticated).toBe(true);
  });
  it("preserves cached work after an observed token refresh and subsequent refocus", async () => {
    await mount();
    const refreshed = { ...original, access_token: "refreshed-token" };
    h.listener!("TOKEN_REFRESHED", refreshed);
    h.listener!("SIGNED_IN", refreshed);
    expect(h.clear).not.toHaveBeenCalled();
  });
  it.each([
    { ...original, access_token: "new-password-session" },
    { access_token: "session-b", user: { id: "account-b" } },
  ])("clears cached work for a replacement session $access_token", async replacement => {
    await mount(); h.listener!("SIGNED_IN", replacement);
    expect(h.clear).toHaveBeenCalledOnce(); expect(h.runtimeClear).toHaveBeenCalledOnce();
    expect(render().props.value.user?.id).toBe(replacement.user.id);
  });
  it("preserves a deliberate idle unlock only for the same account", async () => {
    await mount(); markIdleUnlockSignIn();
    h.listener!("SIGNED_IN", { ...original, access_token: "unlocked-session" });
    expect(h.clear).not.toHaveBeenCalled();
    markIdleUnlockSignIn();
    h.listener!("SIGNED_IN", { access_token: "other-session", user: { id: "account-b" } });
    expect(h.clear).toHaveBeenCalledOnce();
  });
  it("does not replace a newer account event with a delayed initial read", async () => {
    let resolve!: (value: unknown) => void;
    h.getSession.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await mount();
    h.listener!("SIGNED_IN", { access_token: "session-b", user: { id: "account-b" } });
    expect(render().props.value.isLoading).toBe(false);
    resolve({ data: { session: original }, error: null }); await Promise.resolve();
    expect(render().props.value.user?.id).toBe("account-b");
  });
  it("settles a failed initial read so sign-in can recover", async () => {
    h.getSession.mockRejectedValueOnce(new Error("Storage unavailable"));
    await mount(); await Promise.resolve();
    expect(render().props.value.isLoading).toBe(false);
    expect(render().props.value.isAuthenticated).toBe(false);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't restore your session" }));
  });
  it("ignores an initial read that completes after provider cleanup", async () => {
    let resolve!: (value: unknown) => void;
    h.getSession.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await mount(); cleanup?.(); cleanup = undefined;
    const state = [...h.state];
    resolve({ data: { session: original }, error: null }); await Promise.resolve();
    expect(h.state).toEqual(state); expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
  it("confirms a password session only after its successful response", async () => {
    await mount();
    h.listener!("PASSWORD_RECOVERY", original);
    const passwordSession = { ...original, access_token: "password-session" };
    h.signIn.mockImplementationOnce(async () => {
      h.listener!("SIGNED_IN", passwordSession);
      expect(render().props.value.isAuthenticated).toBe(false);
      return { data: { session: passwordSession }, error: null };
    });
    await signInWithPassword({ email: "test@example.test", password: "correct" });
    expect(render().props.value.isAuthenticated).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("cmt-recovery-user-ids") ?? "[]")).toEqual([]);
  });
  it("cannot turn another tab's recovery into a confirmed login during a failed password request", async () => {
    await mount();
    const recovery = { access_token: "recovery-b", user: { id: "account-b" } };
    h.signIn.mockImplementationOnce(async () => {
      window.localStorage.setItem("cmt-recovery-user-ids", JSON.stringify(["account-b"]));
      h.listener!("SIGNED_IN", recovery);
      return { data: { session: null }, error: new Error("Incorrect password") };
    });
    markIdleUnlockSignIn();
    await signInWithPassword({ email: "test@example.test", password: "incorrect" });
    expect(render().props.value.isAuthenticated).toBe(false);
    h.listener!("SIGNED_IN", recovery);
    expect(render().props.value.isAuthenticated).toBe(false);
  });
  it("does not clear a newer recovery for the same account after a delayed password response", async () => {
    await mount();
    h.signIn.mockImplementationOnce(async () => {
      const successful = { ...original, access_token: "password-session" };
      h.listener!("SIGNED_IN", successful);
      h.listener!("PASSWORD_RECOVERY", { ...original, access_token: "newer-recovery" });
      return { data: { session: successful }, error: null };
    });
    await signInWithPassword({ email: "test@example.test", password: "correct" });
    expect(render().props.value.isAuthenticated).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("cmt-recovery-user-ids")!)).toContain("account-a");
  });
  it("does not leave a failed idle-password marker to preserve a later replacement session", async () => {
    await mount(); markIdleUnlockSignIn();
    h.signIn.mockResolvedValueOnce({ data: { session: null }, error: new Error("Incorrect password") });
    await signInWithPassword({ email: "test@example.test", password: "incorrect" });
    h.listener!("SIGNED_IN", { ...original, access_token: "replacement-session" });
    expect(h.clear).toHaveBeenCalledOnce();
  });

  function compareScope() { const tree = render(); h.effects[1](); return tree; }
  it("clears clinical caches once when a repeated session observes a secondary assignment removal", async () => {
    await mount(); h.scope = ["home", "second"]; compareScope();
    h.listener!("SIGNED_IN", original); expect(h.clear).not.toHaveBeenCalled();
    h.scope = ["home"]; compareScope();
    expect(h.clear).toHaveBeenCalledOnce(); expect(h.runtimeClear).toHaveBeenCalledOnce();
    h.scope = undefined; compareScope(); // the clear's transient query reset
    h.scope = ["home"]; compareScope();
    expect(h.clear).toHaveBeenCalledOnce();
    const { wipeOfflineServiceDrafts } = await import("./offlineServiceDraftCache");
    expect(wipeOfflineServiceDrafts).not.toHaveBeenCalled(); // scope-only changes reconcile per draft
  });
  it.each([null, undefined])("preserves drafts and the prior baseline through temporarily unavailable scope %j", async unavailable => {
    await mount(); h.scope = ["home", "second"]; compareScope();
    h.scope = unavailable; compareScope(); expect(h.clear).not.toHaveBeenCalled();
    h.scope = ["second", "home"]; compareScope(); expect(h.clear).not.toHaveBeenCalled();
    const { wipeOfflineServiceDrafts } = await import("./offlineServiceDraftCache");
    expect(wipeOfflineServiceDrafts).not.toHaveBeenCalled();
    h.scope = unavailable; compareScope();
    h.scope = ["home"]; compareScope(); expect(h.clear).toHaveBeenCalledOnce();
    expect(wipeOfflineServiceDrafts).not.toHaveBeenCalled();
  });
  it("preserves offline care documentation when access is added without revoking any facility", async () => {
    await mount(); h.scope = ["home"]; compareScope();
    h.scope = ["home", "new-site"]; compareScope();
    expect(h.clear).toHaveBeenCalledOnce();
    const { wipeOfflineServiceDrafts } = await import("./offlineServiceDraftCache");
    expect(wipeOfflineServiceDrafts).not.toHaveBeenCalled();
  });
  it("exposes initial confirmed scope and rejects stale read generations after scope or account changes", async () => {
    await mount(); expect(compareScope().props.value.offlineFacilityScope).toBeUndefined();
    h.scope = ["home"]; const initial = compareScope().props.value.offlineFacilityScope!;
    expect(initial.facilityIds).toEqual(["home"]); expect(initial.isCurrent()).toBe(true);
    h.scope = undefined; const retained = compareScope().props.value.offlineFacilityScope!;
    expect(retained.facilityIds).toEqual(["home"]); expect(initial.isCurrent()).toBe(true);
    h.scope = ["home", "second"]; const expanded = compareScope().props.value.offlineFacilityScope!;
    expect(initial.isCurrent()).toBe(false); expect(expanded.isCurrent()).toBe(true);
    h.scope = undefined; h.listener!("SIGNED_IN", { access_token: "other", user: { id: "other-user" } });
    expect(expanded.isCurrent()).toBe(false); // before React renders the new account
    expect(compareScope().props.value.offlineFacilityScope).toBeUndefined(); expect(expanded.isCurrent()).toBe(false);
    h.listener!("SIGNED_IN", original); h.scope = ["home", "second"];
    expect(compareScope().props.value.offlineFacilityScope!.isCurrent()).toBe(true);
    expect(expanded.isCurrent()).toBe(false); // returning to the old identity cannot revive its read
  });
  it("invalidates captured draft scope immediately on sign-out while preserving ordinary session events", async () => {
    await mount(); h.scope = ["home"];
    const scope = compareScope().props.value.offlineFacilityScope!;
    h.listener!("SIGNED_IN", original); expect(scope.isCurrent()).toBe(true);
    h.listener!("TOKEN_REFRESHED", { ...original, access_token: "refreshed" }); expect(scope.isCurrent()).toBe(true);
    markIdleUnlockSignIn();
    h.listener!("SIGNED_IN", { ...original, access_token: "idle-unlock" }); expect(scope.isCurrent()).toBe(true);
    h.listener!("SIGNED_OUT", null); expect(scope.isCurrent()).toBe(false);
  });
  it("preserves initial resolution and unchanged scope for managers without an employee row", async () => {
    h.role = "facility_manager"; h.primary = null;
    await mount(); compareScope(); h.scope = ["first", "second"]; compareScope();
    h.listener!("SIGNED_IN", original); h.scope = ["second", "first"]; compareScope();
    expect(h.clear).not.toHaveBeenCalled();
    h.scope = []; compareScope(); expect(h.clear).toHaveBeenCalledOnce();
  });
  it("preserves an established employee draft through idle unlock and temporary scope unavailability", async () => {
    await mount(); h.scope = ["home", "second"]; compareScope();
    markIdleUnlockSignIn();
    h.listener!("SIGNED_IN", { ...original, access_token: "idle-unlock" });
    h.scope = null; compareScope(); // the guarded primary read retains its cached value on error
    h.scope = ["home", "second"]; compareScope();
    expect(h.clear).not.toHaveBeenCalled(); expect(h.runtimeClear).not.toHaveBeenCalled();
    const { wipeOfflineServiceDrafts } = await import("./offlineServiceDraftCache");
    expect(wipeOfflineServiceDrafts).not.toHaveBeenCalled();
  });
  it("still clears role and organization changes while facility scope is unresolved", async () => {
    await mount(); h.scope = ["home"]; compareScope();
    h.scope = undefined; h.role = "facility_manager"; compareScope(); expect(h.clear).toHaveBeenCalledOnce();
    h.org = "other-org"; compareScope(); expect(h.clear).toHaveBeenCalledTimes(2);
  });
});
