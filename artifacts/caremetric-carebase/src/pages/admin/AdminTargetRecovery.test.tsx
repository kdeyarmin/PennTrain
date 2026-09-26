import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>,
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  profiles: [] as Record<string, unknown>[], deliveries: [] as Record<string, unknown>[], terms: [] as Record<string, unknown>[],
  update: vi.fn(), resetMfa: vi.fn(), bulkRetry: vi.fn(), toast: vi.fn(), rpc: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "target",
  useState: (initial: unknown) => {
    const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }];
  },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectCursor++;
    if (!deps || !h.deps[index] || deps.some((dep, i) => !Object.is(dep, h.deps[index]?.[i]))) { h.effects.push(effect); h.deps[index] = deps; }
  },
}));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["", vi.fn()], useSearch: () => "" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin", role: "platform_admin" }, hasRole: () => true }), useSignOut: vi.fn() }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({
  useListProfiles: () => ({ data: h.profiles }), useUpdateProfile: () => ({ mutate: h.update }), useResetUserMfa: () => ({ mutate: h.resetMfa }),
  useCreateUserViaAdmin: () => ({}), useInviteUser: () => ({}), useAdminUpdateUser: () => ({}),
}));
vi.mock("@/hooks/useOrganizations", () => ({ useListOrganizations: () => ({ data: [] }) }));
vi.mock("@/hooks/useImpersonation", () => ({ useStartImpersonation: () => ({}) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useListMyFacilityAssignments: () => ({ data: [] }) }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: (defaults: unknown) => [defaults, vi.fn()] }));
vi.mock("@/hooks/useNotificationReach", () => ({ useNotificationReach: () => ({ data: [] }) }));
vi.mock("@/hooks/useAdminNotificationDeliveries", () => ({
  useListNotificationDeliveries: () => ({ data: h.deliveries }), useOrganizationNameMap: () => ({ data: {} }),
  useBulkRetryNotificationDeliveries: () => ({ mutateAsync: h.bulkRetry }), useRetryNotificationDelivery: () => ({}),
  useNotificationDeliveryOperations: () => ({}), useNotificationDeliveryEvidence: () => ({}), useNotificationTemplateLibrary: () => ({ data: [] }),
  usePreviewNotificationTemplate: () => ({}), useCreateNotificationTemplateVersion: () => ({}), useActivateNotificationTemplate: () => ({}),
  useSetNotificationSpendPolicy: () => ({}), useSetNotificationChannelPolicy: () => ({}), useAcknowledgeNotificationSpendAlert: () => ({}),
  useNotificationDeliveryHealth: () => ({}), usePreviewSavedNotificationTemplate: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: h.terms }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
import Users from "../app/Users";
import NotificationDeliveries from "./NotificationDeliveries";
import { IndependentModuleAccess } from "@/components/billing/IndependentModuleAccess";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function render(Page: () => ReactNode) {
  for (let i = 0; i < 12; i++) {
    h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false;
    const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Page did not settle");
}
const click = (node: Node) => (node.props.onClick as (event: unknown) => unknown)({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = [];
  vi.stubGlobal("window", { location: { search: "" } });
  h.profiles = ["Alice", "Beth"].map((name, index) => ({ id: `user-${index}`, first_name: name, last_name: "Staff", email: `${name}@example.test`, role: "employee", is_active: true, sms_opt_in: false, preferred_notification_channel: "email" }));
  h.deliveries = ["a", "b", "c"].map(id => ({ id, recipient: `${id}@example.test`, status: "failed", final_outcome: "failed", delivery_type: "reminder", channel: "email", created_at: "2026-09-01T12:00:00Z" }));
  h.terms = [{ id: "term-a", module_key: "modules.train", source: "complimentary", reason: "Original grant" }];
  h.rpc.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("administration asynchronous target recovery", () => {
  it("keeps a newly opened profile editor when an earlier profile save completes", () => {
    click(render(Users).find(node => node.props["aria-label"] === "Edit Alice Staff")!);
    click(render(Users).find(node => node.props.children === "Save Changes")!);
    const callback = h.update.mock.calls[0][1].onSuccess;
    click(render(Users).find(node => node.props["aria-label"] === "Edit Beth Staff")!);
    callback();
    const tree = render(Users);
    expect(tree.find(node => node.props.id === "target-email-2")?.props.value).toBe("Beth@example.test");
    expect(tree.some(node => node.props.open === true)).toBe(true);
  });
  it("keeps a new MFA recovery target when the old reset completes", () => {
    click(render(Users).find(node => node.props["aria-label"] === "Reset multi-factor enrollment for Alice Staff")!);
    const reason = () => (render(Users).find(node => node.props.id === "target-reset-mfa-reason")!.props.onChange as (event: unknown) => void)({ target: { value: "Identity verified during recovery" } });
    reason();
    click(render(Users).find(node => node.props.children === "Reset multi-factor")!);
    const callback = h.resetMfa.mock.calls[0][1].onSuccess;
    click(render(Users).find(node => node.props["aria-label"] === "Reset multi-factor enrollment for Beth Staff")!);
    callback({ removed_factor_ids: ["old-factor"] });
    expect(render(Users).some(node => node.props.open === true)).toBe(true);
    reason();
    click(render(Users).find(node => node.props.children === "Reset multi-factor")!);
    expect(h.resetMfa).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "user-1" }), expect.any(Object));
  });
  it("retains failed retry selections and selections added while the batch was running", async () => {
    const batch = deferred<PromiseSettledResult<void>[]>(); h.bulkRetry.mockReturnValueOnce(batch.promise);
    const checkbox = (id: string) => render(NotificationDeliveries).find(node => node.props["aria-label"] === `Select delivery to ${id}@example.test`)!;
    (checkbox("a").props.onCheckedChange as () => void)(); (checkbox("b").props.onCheckedChange as () => void)();
    const completion = click(render(NotificationDeliveries).find(node => node.props.children === "Retry Selected")!);
    (checkbox("c").props.onCheckedChange as () => void)();
    batch.resolve([{ status: "fulfilled", value: undefined }, { status: "rejected", reason: new Error("Retry unavailable") }]); await completion;
    expect(checkbox("a").props.checked).toBe(false);
    expect(checkbox("b").props.checked).toBe(true);
    expect(checkbox("c").props.checked).toBe(true);
  });
  it("revokes an existing access term despite an invalid date in the unrelated grant form", async () => {
    const page = () => IndependentModuleAccess({ organizationId: "org" });
    // HTML date controls permit extended years, while the facility date parser rejects them.
    (render(page).find(node => node.props.type === "datetime-local")!.props.onChange as (event: unknown) => void)({ target: { value: "10000-01-01T12:00" } });
    (render(page).find(node => node.props.minLength === 10)!.props.onChange as (event: unknown) => void)({ target: { value: "End complimentary access" } });
    (render(page).find(node => node.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Access update failed" }));
    click(render(page).find(node => node.props.children === "Revoke")!);
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    expect(h.rpc).toHaveBeenCalledWith("manage_module_access_term", expect.objectContaining({ p_organization_id: "org", p_revoke_id: "term-a", p_reason: "End complimentary access" }));
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty("p_ends_at");
  });
});
