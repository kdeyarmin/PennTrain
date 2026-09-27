import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mutation = { onSuccess: (data?: { url?: string }) => void; onError: (error: Error) => void };
const h = vi.hoisted(() => ({ mutations: [] as Mutation[], effects: [] as (() => void | (() => void))[], ssoPending: false,
  navigate: vi.fn(), toast: vi.fn(), mutate: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); },
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: Mutation) => { const index = h.mutations.push(options) - 1; return { isPending: index === 1 && h.ssoPending, mutate: h.mutate }; },
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/login", h.navigate], useSearch: () => "", Link: "a" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ signInWithPassword: vi.fn() }));
vi.mock("@/lib/usePageMeta", () => ({ usePageMeta: vi.fn() }));
import Login from "./Login";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function mount() { const tree = nodes(Login()); const cleanups = h.effects.map(effect => effect()); return { tree, unmount: () => cleanups.forEach(cleanup => cleanup?.()) }; }
beforeEach(() => {
  vi.clearAllMocks(); h.mutations = []; h.effects = []; h.ssoPending = false;
  vi.stubGlobal("window", { location: { search: "?next=%2Fme%2Fcertificates", origin: "https://example.test", href: "https://example.test/login" } });
});
afterEach(() => vi.unstubAllGlobals());
describe("login request lifecycle", () => {
  it("prevents password submission while enterprise sign-in is pending", () => {
    h.ssoPending = true; const { tree } = mount();
    expect(tree.find(node => node.props.id === "email")?.props.disabled).toBe(true);
    expect(tree.find(node => node.props.id === "password")?.props.disabled).toBe(true);
    expect(tree.find(node => node.props.type === "submit")?.props.disabled).toBe(true);
    (tree.find(node => node.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    expect(h.mutate).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("does not redirect an abandoned login page to an old SSO response", () => {
    const { unmount } = mount(); unmount(); h.mutations[1].onSuccess({ url: "https://identity.example.test/authorize" });
    expect(window.location.href).toBe("https://example.test/login");
  });
  it("does not navigate or show late password feedback after leaving login", () => {
    const { unmount } = mount(); unmount(); h.mutations[0].onSuccess(); h.mutations[0].onError(new Error("Old failure"));
    expect(h.navigate).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("preserves the requested destination and the current SSO redirect", () => {
    mount(); h.mutations[0].onSuccess(); expect(h.navigate).toHaveBeenCalledWith("/me/certificates");
    h.mutations[1].onSuccess({ url: "https://identity.example.test/authorize" });
    expect(window.location.href).toBe("https://identity.example.test/authorize");
  });
});
