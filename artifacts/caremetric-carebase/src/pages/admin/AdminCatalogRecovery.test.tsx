import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>, cleanups: [] as unknown[],
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  createPackage: vi.fn(), updatePackage: vi.fn(), createPrice: vi.fn(), updatePrice: vi.fn(), deletePackage: vi.fn(), deletePrice: vi.fn(),
  createArticle: vi.fn(), updateArticle: vi.fn(), deleteArticle: vi.fn(), toast: vi.fn(), stop: vi.fn(), start: vi.fn(),
  disabledVoice: false, voiceStatus: "active",
  org: "org-a", termsLoading: false, termsError: false, rpc: vi.fn(), invalidate: vi.fn(), retry: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "review", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial; return [h.state[i], (next: unknown) => { const value = typeof next === "function" ? next(h.state[i]) : next; if (!Object.is(value, h.state[i])) h.dirty = true; h.state[i] = value; }]; },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => { const i = h.effectCursor++; if (!deps || !h.deps[i] || deps.some((d, j) => !Object.is(d, h.deps[i]?.[j]))) { h.effects.push(() => { if (typeof h.cleanups[i] === "function") (h.cleanups[i] as () => void)(); h.cleanups[i] = effect(); }); h.deps[i] = deps; } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "operator", role: "platform_admin" } }) }));
vi.mock("@/components/billing/PackageEntitlementTermCard", () => ({ PackageEntitlementTermCard: "terms" }));
vi.mock("@/hooks/usePackages", () => ({
  useListPackages: () => ({ data: [] }), useListPackageBillingPrices: () => ({ data: [] }),
  useCreatePackage: () => ({ mutate: h.createPackage }), useUpdatePackage: () => ({ mutate: h.updatePackage }), useDeletePackage: () => ({ mutate: h.deletePackage }),
  useCreatePackageBillingPrice: () => ({ mutate: h.createPrice }), useUpdatePackageBillingPrice: () => ({ mutate: h.updatePrice }), useDeletePackageBillingPrice: () => ({ mutate: h.deletePrice }),
}));
vi.mock("@/hooks/useHelpArticles", () => ({
  useListHelpArticles: () => ({ data: ["a", "b"].map(id => ({ id, article_type: "faq", category: "General", title: id, sort_order: 0, is_published: true, content: { answer: `Answer ${id}` } })) }),
  useCreateHelpArticle: () => ({ mutate: h.createArticle }), useUpdateHelpArticle: () => ({ mutate: h.updateArticle }), useDeleteHelpArticle: () => ({ mutate: h.deleteArticle }),
}));
vi.mock("@/hooks/usePlatformSettings", () => ({ useListPlatformSettings: () => ({ data: [{ key: "voice_assistant_enabled", value: !h.disabledVoice }] }) }));
vi.mock("@/hooks/useVoiceSession", () => ({ useVoiceSession: () => ({ status: h.voiceStatus, stop: h.stop, start: h.start, turns: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }), useQuery: () => ({ data: [], isLoading: h.termsLoading, isError: h.termsError, refetch: h.retry }) }));
import Packages from "./Packages";
import HelpContent from "./HelpContent";
import { VoiceAssistantPanel } from "@/components/voice/VoiceAssistantPanel";
import { IndependentModuleAccess } from "@/components/billing/IndependentModuleAccess";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function render(Page: () => ReactNode) { for (let i = 0; i < 12; i++) { h.cursor = h.refCursor = h.effectCursor = 0; h.effects = []; h.dirty = false; const tree = nodes(Page()); h.effects.forEach(e => e()); if (!h.dirty) return tree; } throw new Error("Render did not settle"); }
const textMatches = (n: Node, s: string) => n.props.children === s || Array.isArray(n.props.children) && n.props.children.some(v => typeof v === "string" && v.trim() === s);
const click = (n: Node) => (n.props.onClick as () => unknown)();
const button = (Page: () => ReactNode, title: string) => render(Page).find(n => typeof n.props.onClick === "function" && textMatches(n, title))!;
const change = (Page: () => ReactNode, suffix: string, value: string) => (render(Page).find(n => n.props.id === `review-${suffix}`)!.props.onChange as (e: unknown) => void)({ target: { value } });
const select = (suffix: string, value: string) => (render(Packages).find(n => typeof n.props.onValueChange === "function" && nodes(n.props.children as ReactNode).some(c => c.props.id === `review-${suffix}`))!.props.onValueChange as (value: string) => void)(value);
const dialog = (Page: () => ReactNode, title: string) => render(Page).find(n => typeof n.props.onOpenChange === "function" && nodes(n.props.children as ReactNode).some(c => c.props.children === title))!;
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.disabledVoice = false; h.voiceStatus = "active"; h.org = "org-a"; h.termsError = h.termsLoading = false; h.rpc.mockReset().mockResolvedValue({ error: null }); });
afterEach(() => h.cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); }));
describe("catalog input and asynchronous recovery", () => {
  it.each([["trial-days", "1.5"], ["trial-days", "91"], ["hard-facility-limit", "2.9"], ["hard-learner-limit", "Infinity"], ["sort-order", "1junk"], ["annual-discount", "Infinity"], ["annual-discount", "51"], ["starting-monthly-price", "Infinity"], ["starting-monthly-price", "1.234"]])("rejects invalid %s=%s before writing", (field, value) => {
    click(button(Packages, "Add package")); change(Packages, "package-name", "Plan"); change(Packages, field, value); click(button(Packages, "Create package"));
    expect(h.createPackage).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("preserves zero limits, no trial and exact cents", () => {
    click(button(Packages, "Add package")); change(Packages, "package-name", "Plan"); change(Packages, "trial-days", "0"); change(Packages, "hard-facility-limit", "0"); change(Packages, "starting-monthly-price", "19.99"); click(button(Packages, "Create package"));
    expect(h.createPackage).toHaveBeenCalledWith(expect.objectContaining({ trial_days: 0, facility_limit: 0, learner_limit: null, price_monthly_cents: 1999 }), expect.any(Object));
  });
  it("opens the next billing step only for the current successfully created package", () => {
    click(button(Packages, "Add package")); change(Packages, "package-name", "Plan"); click(button(Packages, "Create package")); h.createPackage.mock.calls[0][1].onSuccess({ id: "saved" });
    expect(dialog(Packages, "Edit package").props.open).toBe(false); expect(dialog(Packages, "Add billing configuration").props.open).toBe(true);
  });
  it("keeps later typing attached to the newly created package instead of creating a duplicate", () => {
    click(button(Packages, "Add package")); change(Packages, "package-name", "Plan"); click(button(Packages, "Create package")); change(Packages, "package-name", "Revised plan"); h.createPackage.mock.calls[0][1].onSuccess({ id: "saved" });
    expect(dialog(Packages, "Edit package").props.open).toBe(true); click(button(Packages, "Save changes")); expect(h.updatePackage).toHaveBeenCalledWith(expect.objectContaining({ id: "saved", name: "Revised plan" }), expect.any(Object));
  });
  it("does not close a replacement package editor or open its obsolete billing follow-up", () => {
    click(button(Packages, "Add package")); change(Packages, "package-name", "First"); click(button(Packages, "Create package"));
    (dialog(Packages, "Add package").props.onOpenChange as (open: boolean) => void)(false); click(button(Packages, "Add package")); change(Packages, "package-name", "Second");
    h.createPackage.mock.calls[0][1].onSuccess({ id: "first" });
    expect(dialog(Packages, "Add package").props.open).toBe(true); expect(dialog(Packages, "Add billing configuration").props.open).toBe(false);
  });
  it.each([["included-quantity", "1.5"], ["minimum-quantity", "0"], ["maximum-quantity", "0"], ["maximum-quantity", "2.2"], ["per-unit-overage-amount", "Infinity"], ["per-unit-overage-amount", "-1"], ["sort-order-2", "2.5"]])("rejects invalid billing %s=%s", (field, value) => {
    click(button(Packages, "Add billing price")); select("package", "plan"); select("value-metric", "active_learner"); change(Packages, "base-amount", "10"); change(Packages, field, value); click(button(Packages, "Save billing configuration"));
    expect(h.createPrice).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("does not discard a newer billing draft after save", () => {
    click(button(Packages, "Add billing price")); select("package", "plan"); change(Packages, "base-amount", "10"); click(button(Packages, "Save billing configuration"));
    change(Packages, "configuration-name", "Next price"); h.createPrice.mock.calls[0][1].onSuccess({ id: "saved-price" });
    expect(dialog(Packages, "Edit billing configuration").props.open).toBe(true);
    click(button(Packages, "Save billing configuration")); expect(h.updatePrice).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-price", display_name: "Next price" }), expect.any(Object));
  });
  it("keeps a failed billing form available and closes an unchanged successful retry", () => {
    click(button(Packages, "Add billing price")); select("package", "plan"); change(Packages, "base-amount", "10"); click(button(Packages, "Save billing configuration")); h.createPrice.mock.calls[0][1].onError(new Error("Rejected"));
    expect(dialog(Packages, "Add billing configuration").props.open).toBe(true); click(button(Packages, "Save billing configuration")); h.createPrice.mock.calls[1][1].onSuccess({ id: "price" }); expect(dialog(Packages, "Add billing configuration").props.open).toBe(false);
  });
});
describe("help authoring recovery", () => {
  it("keeps a newer article editor open after the earlier save completes", () => {
    click(render(HelpContent).filter(n => n.props["aria-label"] === "Edit article")[0]); click(button(HelpContent, "Save Changes"));
    click(render(HelpContent).filter(n => n.props["aria-label"] === "Edit article")[1]); h.updateArticle.mock.calls[0][1].onSuccess();
    expect(render(HelpContent).find(n => typeof n.props.onOpenChange === "function" && typeof n.props.open === "boolean")!.props.open).toBe(true);
    expect(render(HelpContent).find(n => n.props.id === "review-field")!.props.value).toBe("b");
  });
  it("retains text typed while the prior draft saves", () => {
    click(render(HelpContent).filter(n => n.props["aria-label"] === "Edit article")[0]); click(button(HelpContent, "Save Changes")); change(HelpContent, "answer", "New answer"); h.updateArticle.mock.calls[0][1].onSuccess();
    expect(render(HelpContent).find(n => typeof n.props.onOpenChange === "function" && typeof n.props.open === "boolean")!.props.open).toBe(true);
  });
  it("continues editing the saved article when creation finishes after further typing", () => {
    click(button(HelpContent, "New Article")); change(HelpContent, "category", "General"); change(HelpContent, "field", "Question"); change(HelpContent, "answer", "Answer"); click(button(HelpContent, "Create Article")); change(HelpContent, "answer", "New answer"); h.createArticle.mock.calls[0][1].onSuccess({ id: "saved-article" });
    click(button(HelpContent, "Save Changes")); expect(h.updateArticle).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-article", content: { answer: "New answer" } }), expect.any(Object));
  });
  it("does not clear another article's delete confirmation on delayed success", () => {
    click(render(HelpContent).filter(n => n.props["aria-label"] === "Delete article")[0]); click(button(HelpContent, "Delete"));
    click(render(HelpContent).filter(n => n.props["aria-label"] === "Delete article")[1]); h.deleteArticle.mock.calls[0][1].onSuccess();
    const confirmation = dialog(HelpContent, "Delete this article?"); expect(confirmation.props.open).toBe(true); click(button(HelpContent, "Delete")); expect(h.deleteArticle.mock.calls[1][0]).toBe("b");
  });
});
describe("voice controls", () => {
  it.each(["active", "requesting", "connecting"])("stops a %s session when its platform control becomes disabled", status => {
    h.voiceStatus = status; const Page = () => VoiceAssistantPanel({ facilityId: "a" }); render(Page); h.disabledVoice = true; render(Page); expect(h.stop).toHaveBeenCalledOnce();
  });
  it.each(["requesting", "connecting"])("allows the user to cancel while %s", status => {
    h.voiceStatus = status; const Page = () => VoiceAssistantPanel({ facilityId: "a" }); const cancel = button(Page, "Cancel voice session"); expect(cancel).toBeDefined(); click(cancel); expect(h.stop).toHaveBeenCalledOnce();
  });
});
describe("independent access context", () => {
  const Page = () => IndependentModuleAccess({ organizationId: h.org });
  const reasonInput = () => render(Page).find(n => n.props.minLength === 10)!;
  const reason = (value: string) => (reasonInput().props.onChange as (e: unknown) => void)({ target: { value } });
  const submit = () => (render(Page).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  it.each(["loading", "error"])("blocks new grants while existing access is %s", state => {
    h.termsLoading = state === "loading"; h.termsError = state === "error";
    expect(render(Page).find(n => textMatches(n, "Grant module access"))!.props.disabled).toBe(true); submit(); expect(h.rpc).not.toHaveBeenCalled();
    if (h.termsError) { click(button(Page, "Retry")); expect(h.retry).toHaveBeenCalledOnce(); }
  });
  it("clears organization-specific reason and dates when changing organizations", () => {
    reason("Contract with organization A");
    (render(Page).find(n => n.props.type === "datetime-local")!.props.onChange as (e: unknown) => void)({ target: { value: "2027-01-01T10:00" } });
    h.org = "org-b"; render(Page); expect(reasonInput().props.value).toBe(""); expect(render(Page).find(n => n.props.type === "datetime-local")!.props.value).toBe("");
  });
  it("a late prior-organization grant cannot release a newer pending control or report success there", async () => {
    let resolve!: (value: unknown) => void; h.rpc.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    reason("Approved contract A"); submit(); h.org = "org-b"; render(Page);
    h.rpc.mockReturnValueOnce(new Promise(() => {})); reason("Approved contract B"); submit(); resolve({ error: null });
    await vi.waitFor(() => expect(h.invalidate).toHaveBeenCalled());
    expect(h.toast).not.toHaveBeenCalled(); expect(render(Page).find(n => textMatches(n, "Grant module access"))!.props.disabled).toBe(true);
  });
});
