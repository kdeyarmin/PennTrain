import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestSession = { user: { id: string } } | null;
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0,
  effect: undefined as (() => void | (() => void)) | undefined,
  event: undefined as ((event: string, session: TestSession) => void) | undefined,
  getSession: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), clearCache: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => {
      h.state[index] = typeof value === "function" ? value(h.state[index]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = h.refCursor++;
    return h.refs[index] ?? (h.refs[index] = { current: initial });
  },
  useEffect: (effect: () => void | (() => void)) => { h.effect = effect; },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/supabase", () => ({
  clearSupabaseRuntimeCache: h.clearCache,
  supabase: { auth: {
    getSession: h.getSession, updateUser: h.updateUser, signOut: h.signOut,
    onAuthStateChange: (listener: typeof h.event) => {
      h.event = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  } },
}));

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}

describe("password recovery account binding", () => {
  let ResetPassword: () => ReactElement;
  let cleanup: (() => void) | void;
  let current: TestSession;
  let marked: string[];
  function render() {
    h.cursor = 0;
    h.refCursor = 0;
    return nodes(ResetPassword());
  }
  function fill(id: string, value: string) {
    const input = render().find((node) => node.props.id === id)!;
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  }
  async function mount() {
    render();
    cleanup = h.effect!();
    await Promise.resolve();
  }
  function form() {
    return render().find((node) => node.type === "form");
  }
  async function submit() {
    await (form()!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
  }
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    h.state = []; h.refs = []; h.cursor = 0; h.refCursor = 0; h.event = undefined;
    current = { user: { id: "invited-user" } };
    marked = ["invited-user"];
    cleanup = undefined;
    vi.stubGlobal("window", {
      location: { hash: "#type=invite" },
      localStorage: { getItem: () => JSON.stringify(marked) },
    });
    h.getSession.mockImplementation(async () => ({ data: { session: current }, error: null }));
    h.updateUser.mockResolvedValue({ error: null });
    h.signOut.mockResolvedValue({ error: null });
    h.clearCache.mockResolvedValue(undefined);
    ResetPassword = (await import("./ResetPassword")).default;
  });
  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("finishes a valid invitation and requires a fresh sign-in", async () => {
    await mount();
    fill("password", "new-password"); fill("confirmPassword", "new-password");
    await submit();
    expect(h.updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(h.signOut).toHaveBeenCalledOnce();
    expect(form()).toBeUndefined();
  });
  it("accepts an invitation established after mounting through INITIAL_SESSION then SIGNED_IN", async () => {
    current = null;
    marked = [];
    await mount();
    expect(form()).toBeUndefined();
    current = { user: { id: "invited-user" } };
    // AuthProvider subscribes before this route and marks the matching URL-granted session.
    marked = ["invited-user"];
    h.event!("INITIAL_SESSION", current);
    h.event!("SIGNED_IN", current);
    fill("password", "new-password"); fill("confirmPassword", "new-password");
    await submit();
    expect(h.updateUser).toHaveBeenCalledWith({ password: "new-password" });
  });
  it("does not let a stale initial read failure replace a newer recovery event", async () => {
    let rejectInitial!: (reason: Error) => void;
    h.getSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectInitial = reject; }));
    await mount();
    h.event!("INITIAL_SESSION", current);
    rejectInitial(new Error("Initial session read failed"));
    await Promise.resolve(); await Promise.resolve();
    expect(form()).toBeDefined();
  });
  it("does not treat an invite-looking URL as proof an existing session is a recovery session", async () => {
    marked = [];
    await mount();
    await vi.advanceTimersByTimeAsync(2500);
    expect(form()).toBeUndefined();
    expect(h.updateUser).not.toHaveBeenCalled();
    cleanup?.(); cleanup = undefined;
    await Promise.resolve();
    expect(h.signOut).not.toHaveBeenCalled();
  });
  it("clears the form when another tab changes account and never signs out the replacement", async () => {
    await mount(); fill("password", "private-draft");
    current = { user: { id: "different-user" } };
    h.event!("SIGNED_IN", current);
    expect(form()).toBeUndefined();
    expect(h.state).not.toContain("private-draft");
    cleanup?.(); cleanup = undefined;
    await Promise.resolve();
    expect(h.signOut).not.toHaveBeenCalled();
  });
  it("rechecks the current identity before updating even when the cross-tab event is delayed", async () => {
    await mount();
    fill("password", "new-password"); fill("confirmPassword", "new-password");
    current = { user: { id: "different-user" } };
    await submit();
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(form()).toBeUndefined();
  });
  it("invalidates an ended recovery and does not rebind a typed form to a later recovery", async () => {
    await mount();
    h.event!("SIGNED_OUT", null);
    marked = ["another-invited-user"];
    h.event!("PASSWORD_RECOVERY", { user: { id: "another-invited-user" } });
    expect(form()).toBeUndefined();
  });
  it("does not abandon a different session if storage changed before unmount", async () => {
    await mount();
    current = { user: { id: "different-user" } };
    cleanup?.(); cleanup = undefined;
    await Promise.resolve();
    expect(h.signOut).not.toHaveBeenCalled();
  });
  it("abandons the original unfinished recovery session locally", async () => {
    await mount();
    cleanup?.(); cleanup = undefined;
    await Promise.resolve();
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("keeps a failed password update retryable", async () => {
    await mount();
    fill("password", "new-password"); fill("confirmPassword", "new-password");
    h.updateUser.mockResolvedValueOnce({ error: new Error("Password rejected") });
    await submit();
    expect(form()).toBeDefined();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    await submit();
    expect(h.signOut).toHaveBeenCalledOnce();
  });
});
