import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>, cleanups: [] as Array<unknown>,
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  user: "user-a", role: "org_admin", org: "org", queries: {} as Record<string, { data?: any; error?: Error; isLoading?: boolean; isError?: boolean; refetch: ReturnType<typeof vi.fn> }>,
  pushStatus: vi.fn(), enable: vi.fn(), disable: vi.fn(), saveProfile: vi.fn(), session: vi.fn(), assign: vi.fn(), busy: false,
  ask: vi.fn(), reset: vi.fn(), create: vi.fn(), send: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "review", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }];
  },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectCursor++;
    if (!deps || !h.deps[index] || deps.some((dep, i) => !Object.is(dep, h.deps[index]?.[i]))) {
      h.effects.push(() => { if (typeof h.cleanups[index] === "function") (h.cleanups[index] as () => void)(); h.cleanups[index] = effect(); }); h.deps[index] = deps;
    }
  },
}));

vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: h.user, role: h.role, organizationId: h.org } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => h.queries.entitlements, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/appUrl", () => ({ absoluteAppUrl: (path: string) => `https://app.test${path}` }));
vi.mock("@/hooks/useProfiles", () => ({ useMyProfile: () => h.queries.profile, useUpdateProfile: () => ({ mutate: h.saveProfile }) }));
vi.mock("@/lib/pushSubscriptions", () => ({ hasActiveWebPushSubscription: h.pushStatus, enableWebPush: h.enable, disableWebPush: h.disable, getPushPermissionState: () => "granted" }));
vi.mock("@/hooks/useOrganizations", () => ({ useListOrganizations: () => h.queries.organizations, useGetOrganization: () => h.queries.organization }));
vi.mock("@/hooks/usePackages", () => ({ useListPackages: () => h.queries.packages, useListPackageBillingPrices: () => h.queries.prices, useOrganizationBillingUsage: () => h.queries.usage, useOrganizationBillingAccount: () => h.queries.account }));
vi.mock("@/hooks/useEnterpriseFoundation", () => ({ useCreateBillingSession: () => ({ mutateAsync: h.session, isPending: h.busy }) }));
vi.mock("@/components/billing/BillingCheckoutRecovery", () => ({ BillingCheckoutRecovery: "checkout-recovery" }));
import NotificationSettings from "../auth/NotificationSettings";
import { BillingPlanSelector } from "@/components/billing/BillingPlanSelector";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function render(Page: () => ReactNode) {
  for (let i = 0; i < 16; i++) {
    h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false;
    const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Page did not settle");
}
const click = (node: Node) => (node.props.onClick as () => unknown)();
const hasText = (node: Node, value: string) => node.props.children === value || Array.isArray(node.props.children) && node.props.children.some(child => typeof child === "string" && child.trim() === value);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const unmount = () => { h.cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); }); h.cleanups = []; };
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.user = "user-a"; h.org = "org"; h.role = "org_admin"; h.busy = false;
  h.pushStatus.mockReset().mockResolvedValue(false); h.enable.mockResolvedValue(undefined); h.disable.mockResolvedValue(undefined);
  h.queries = Object.fromEntries(["profile", "entitlements", "organizations", "organization", "packages", "prices", "usage", "account"].map(key => [key, { data: [], refetch: vi.fn().mockResolvedValue({}) }]));
  h.queries.profile.data = { id: "user-a", first_name: "First", last_name: "Last", sms_opt_in: false, preferred_notification_channel: "email" };
  h.queries.organization.data = { name: "Test org", trial_ends_at: "2026-01-01T00:00:00Z" };
  h.queries.account.data = { account: { stripe_customer_id: "customer", billing_state: "trialing" }, subscription: null };
  h.queries.packages.data = [{ id: "train", name: "Test Train", is_active: true, features: {}, annual_discount_percent: 0 }];
  h.queries.prices.data = [{ id: "price", package_id: "train", is_active: true, is_primary: true, effective_from: "2026-01-01T00:00:00Z", stripe_price_id: "price_test", billing_metric: "flat", pricing_model: "flat", base_amount_cents: 23900, currency: "usd", recurring_interval: "month", minimum_quantity: 1, maximum_quantity: null }];
  vi.stubGlobal("window", { location: { search: "", assign: h.assign } });
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });
describe("browser notification status recovery", () => {
  const toggle = () => render(NotificationSettings).find(node => node.props.onClick && (hasText(node, "Enable") || hasText(node, "Disable")))!;
  it("keeps unknown status distinct from disabled and offers a successful retry", async () => {
    h.pushStatus.mockRejectedValueOnce(new Error("Status unavailable"));
    expect(toggle().props.disabled).toBe(true); click(toggle()); expect(h.enable).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(render(NotificationSettings).some(node => node.props.what === "browser notification status")).toBe(true));
    expect(toggle().props.disabled).toBe(true); expect(render(NotificationSettings).some(node => hasText(node, "could not be confirmed"))).toBe(true);
    h.pushStatus.mockResolvedValueOnce(true);
    (render(NotificationSettings).find(node => node.props.what === "browser notification status")!.props.onRetry as () => void)(); render(NotificationSettings);
    await vi.waitFor(() => expect(hasText(toggle(), "Disable")).toBe(true)); expect(toggle().props.disabled).toBe(false);
  });
  it("ignores an old user's pending status after account switch", async () => {
    const first = deferred<boolean>(); h.pushStatus.mockReturnValueOnce(first.promise).mockResolvedValueOnce(false);
    render(NotificationSettings); h.user = "user-b"; render(NotificationSettings);
    await vi.waitFor(() => expect(toggle().props.disabled).toBe(false)); first.resolve(true); await first.promise; await Promise.resolve();
    expect(hasText(toggle(), "Enable")).toBe(true);
  });
  it("preserves edited contact preferences through background profile refresh", () => {
    const change = render(NotificationSettings).find(node => node.props.id === "review-first-name")!;
    (change.props.onChange as (event: unknown) => void)({ target: { value: "Edited" } });
    h.queries.profile.data = { ...h.queries.profile.data, first_name: "Server" };
    expect(render(NotificationSettings).find(node => node.props.id === "review-first-name")!.props.value).toBe("Edited");
  });
});
describe("billing reads and navigation", () => {
  it("blocks plan selection and misleading trial notices until module access is known, then retries all billing context", () => {
    h.queries.entitlements.error = new Error("Access unavailable"); h.queries.entitlements.isError = true;
    const tree = render(BillingPlanSelector);
    expect(tree.some(node => node.props.children === "Test Train")).toBe(false);
    expect(tree.some(node => node.props.children === "Trial ended — choose a plan to continue")).toBe(false);
    click(tree.find(node => node.props.children === "Retry billing details")!);
    for (const key of ["packages", "prices", "organization", "account", "entitlements"]) expect(h.queries[key].refetch).toHaveBeenCalledOnce();
  });
  it("keeps plan cards hidden while entitlements are loading", () => {
    h.queries.entitlements.isLoading = true;
    expect(render(BillingPlanSelector).some(node => node.props.children === "Test Train")).toBe(false);
  });
  it("retries a failed platform organization picker", () => {
    h.role = "platform_admin"; h.queries.organizations.isError = true;
    const tree = render(BillingPlanSelector);
    (tree.find(node => node.props.what === "organizations")!.props.onRetry as () => void)();
    expect(h.queries.organizations.refetch).toHaveBeenCalledOnce();
  });
  it("retries missing usage for a metered contract", () => {
    h.queries.prices.data[0].billing_metric = "active_learner"; h.queries.prices.data[0].pricing_model = "per_unit";
    h.queries.usage.data = undefined; h.queries.usage.error = new Error("Offline");
    click(render(BillingPlanSelector).find(node => node.props.children === "Retry usage measurement")!);
    expect(h.queries.usage.refetch).toHaveBeenCalledOnce();
  });
  it.each([["portal", "unmount"], ["checkout", "unmount"], ["portal", "account switch"], ["checkout", "account switch"]])("does not redirect delayed %s after %s", async (action, lifecycle) => {
    const pending = deferred<{ data: { url: string } }>(); h.session.mockReturnValueOnce(pending.promise);
    const operation = click(render(BillingPlanSelector).find(node => hasText(node, action === "portal" ? "Manage billing" : "Start secure checkout"))!);
    expect(h.session).toHaveBeenCalledOnce();
    if (lifecycle === "unmount") unmount(); else { h.user = "user-b"; render(BillingPlanSelector); }
    pending.resolve({ data: { url: "https://billing.test/session" } }); await pending.promise; await operation;
    expect(h.assign).not.toHaveBeenCalled();
  });
  it("opens a successfully created portal for the current account", async () => {
    h.session.mockResolvedValueOnce({ data: { url: "https://billing.test/session" } });
    await click(render(BillingPlanSelector).find(node => hasText(node, "Manage billing"))!);
    expect(h.assign).toHaveBeenCalledWith("https://billing.test/session");
  });
});
