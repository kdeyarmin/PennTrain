import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, effectCursor: 0, deps: [] as unknown[][], effects: [] as Array<() => void>, dirty: false,
  command: vi.fn(), toast: vi.fn(), link: vi.fn(), lookup: vi.fn(), lookupError: false, scope: "east",
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "test", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial; return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }]; },
  useEffect: (effect: () => void, deps: unknown[]) => { const index = h.effectCursor++; if (!h.deps[index] || deps.some((value, n) => !Object.is(value, h.deps[index][n]))) { h.effects.push(effect); h.deps[index] = deps; } },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "work" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "operator", role: "org_admin", organizationId: "org-a" } }) }));
vi.mock("@/lib/pageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEnterpriseFoundation", () => ({ useEnterpriseRpcCommand: () => ({ mutateAsync: h.command }) }));
vi.mock("@/hooks/useEnterpriseRoleTemplates", () => ({ useEnterpriseRoleTemplates: () => ({ data: [] }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useGovernedRecordOptions", () => ({ useAvailableGovernedRecord: (_kind: string, value: string, _organization?: string, optional?: boolean) => !h.lookupError && (!!value || optional), useGovernedRecordOptions: (...args: unknown[]) => { h.lookup(...args); return { isError: h.lookupError, data: [{ id: "incident-one", label: "Incident", description: "Review" }] }; } }));
vi.mock("@/components/GovernedRecordPicker", () => ({ GovernedRecordPicker: "picker" }));
vi.mock("@/hooks/useWorkItems", () => ({
  useGetWorkItem: () => ({ data: { id: "work", title: "Review", organization_id: "org-a", facility_id: h.scope, state: "open", priority: "high", due_at: "2026-09-01T12:00:00Z", source_type: "manual", owner_profile_id: "operator", template: { required_evidence_types: ["completion_record"] } } }),
  useWorkItemActivity: () => ({ data: { watchers: [], evidence: [], dependencies: [], comments: [], history: [] } }),
  useListWorkItems: () => ({ data: [] }), useAddWorkItemComment: () => ({}), useAddWorkItemDependency: () => ({}), useApproveWorkItem: () => ({}), useRecordWorkItemEffectiveness: () => ({}), useRemoveWorkItemDependency: () => ({}), useSetWorkItemWatching: () => ({}),
  useSubmitLinkedWorkItemEvidence: () => ({ mutate: h.link }), useTransitionWorkItem: () => ({}), useUpdateWorkItemAssignment: () => ({}), useUploadWorkItemEvidence: () => ({}), useWorkItemEvidenceUrl: () => ({}),
}));
import { LifecycleCommand, ScopeGrantCommand, EntitlementCommand } from "./EnterpriseFoundation";
import WorkItemDetail from "../app/WorkItemDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function render(Page: () => ReactNode): Node[] { for (let n = 0; n < 8; n++) { h.cursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false; const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree; } throw new Error("Render did not settle"); }
const field = (Page: () => ReactNode, id: string) => render(Page).find(node => node.props.id === id)!;
const select = (Page: () => ReactNode, id: string, value: string) => (field(Page, id).props.onValueChange as (value: string) => void)(value);
const input = (Page: () => ReactNode, id: string, value: string) => (field(Page, id).props.onChange as (event: unknown) => void)({ target: { value } });
const button = (Page: () => ReactNode, title: string) => render(Page).find(node => node.props.children === title || Array.isArray(node.props.children) && node.props.children.includes(` ${title}`))!;
const click = (node: Node) => (node.props.onClick as () => unknown)();
const choose = (Page: () => ReactNode, value: string, next: string) => (render(Page).find(node => node.props.value === value && node.props.onValueChange)!.props.onValueChange as (value: string) => void)(next);
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.deps = []; h.scope = "east"; h.lookupError = false; });
describe("enterprise record choices", () => {
  it("clears employee and facility when switching organization and invalidates the transition preview", async () => {
    select(LifecycleCommand, "phase2-employee-id", "employee-a"); select(LifecycleCommand, "phase2-target-facility", "east"); input(LifecycleCommand, "phase2-transition-reason", "Approved leave request");
    h.command.mockResolvedValue({ allowed: true }); await click(button(LifecycleCommand, "Preview effects"));
    expect(button(LifecycleCommand, "Apply guarded transition").props.disabled).toBe(false);
    select(LifecycleCommand, "phase2-lifecycle-organization", "org-b");
    expect(field(LifecycleCommand, "phase2-employee-id").props.value).toBe(""); expect(field(LifecycleCommand, "phase2-target-facility").props.value).toBe("");
    expect(button(LifecycleCommand, "Apply guarded transition").props.disabled).toBe(true);
  });
  it("requires an allowed preview matching the exact command before applying", async () => {
    select(LifecycleCommand, "phase2-employee-id", "employee-a"); input(LifecycleCommand, "phase2-transition-reason", "Approved leave request");
    h.command.mockResolvedValue({ allowed: false, reasons: ["leave_requires_active_employment"] }); await click(button(LifecycleCommand, "Preview effects"));
    expect(button(LifecycleCommand, "Apply guarded transition").props.disabled).toBe(true); await click(button(LifecycleCommand, "Apply guarded transition")); expect(h.command).toHaveBeenCalledTimes(1);
    h.command.mockResolvedValue({ allowed: true }); await click(button(LifecycleCommand, "Preview effects")); await click(button(LifecycleCommand, "Apply guarded transition"));
    expect(h.command.mock.calls.at(-1)![0]).toEqual({ rpc: "apply_employee_lifecycle_transition", args: { p_employee_id: "employee-a", p_transition: "leave", p_effective_on: expect.any(String), p_facility_id: null, p_reason: "Approved leave request" } });
  });
  it("does not carry a facility ID into another grant scope type", () => {
    select(ScopeGrantCommand, "phase2-grant-scope", "org-a"); choose(ScopeGrantCommand, "organization", "facility"); expect(field(ScopeGrantCommand, "phase2-grant-scope").props.value).toBe(""); expect(field(ScopeGrantCommand, "phase2-grant-scope").props.kind).toBe("facility");
  });
  it("blocks a retained employee selection after its lookup fails", async () => {
    select(LifecycleCommand, "phase2-employee-id", "employee-a"); input(LifecycleCommand, "phase2-transition-reason", "Approved leave request");
    h.lookupError = true;
    expect(button(LifecycleCommand, "Preview effects").props.disabled).toBe(true);
    await click(button(LifecycleCommand, "Preview effects")); expect(h.command).not.toHaveBeenCalled();
  });
  it("submits text entitlements as text without requiring JSON quotes", async () => {
    select(EntitlementCommand, "phase2-entitlement-org", "org-a"); input(EntitlementCommand, "phase2-feature-key", "contract.label"); input(EntitlementCommand, "phase2-entitlement-reason", "Approved contract value");
    choose(EntitlementCommand, "boolean", "text"); input(EntitlementCommand, "phase2-entitlement-value", "North campus"); await click(button(EntitlementCommand, "Record entitlement grant"));
    expect(h.command).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ p_entitlement_value: "North campus" }) }));
  });
});
describe("work documentation choices", () => {
  const fill = () => { select(WorkItemDetail, "test-linked-record", "incident-one"); const tree = render(WorkItemDetail); const linkedSelect = tree.find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props.id === "test-linked-documentation-type"))!; (linkedSelect.props.onValueChange as (value: string) => void)("completion_record"); };
  it("loads choices from the work record's organization and facility", () => { render(WorkItemDetail); expect(h.lookup).toHaveBeenLastCalledWith("incident", "org-a", "east"); expect(field(WorkItemDetail, "test-linked-record").props.facilityId).toBe("east"); });
  it("links the selected scoped record using the existing RPC payload", () => { fill(); click(button(WorkItemDetail, "Link record")); expect(h.link).toHaveBeenCalledWith({ workItemId: "work", evidenceType: "completion_record", linkedRecordType: "incident", linkedRecordId: "incident-one" }, expect.any(Object)); });
  it("blocks submission while choices are unavailable even if a previous choice exists", () => { fill(); h.lookupError = true; expect(button(WorkItemDetail, "Link record").props.disabled).toBe(true); click(button(WorkItemDetail, "Link record")); expect(h.link).not.toHaveBeenCalled(); });
  it("clears a selected record when its type changes", () => { fill(); choose(WorkItemDetail, "incident", "complaint"); expect(field(WorkItemDetail, "test-linked-record").props.value).toBe(""); expect(button(WorkItemDetail, "Link record").props.disabled).toBe(true); });
  it("preserves other supported record types through explicit advanced entry", () => {
    fill(); choose(WorkItemDetail, "incident", "other"); input(WorkItemDetail, "test-other-record-type", "assessment");
    input(WorkItemDetail, "test-other-record-id", "not-a-uuid"); expect(button(WorkItemDetail, "Link record").props.disabled).toBe(true);
    input(WorkItemDetail, "test-other-record-id", "11111111-2222-3333-4444-555555555555"); click(button(WorkItemDetail, "Link record"));
    expect(h.link).toHaveBeenCalledWith(expect.objectContaining({ linkedRecordType: "assessment", linkedRecordId: "11111111-2222-3333-4444-555555555555" }), expect.any(Object));
  });
  it("keeps the upload's documentation type independent from record linking", () => {
    const tree = render(WorkItemDetail); const uploadSelect = tree.find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props.id === "test-upload-documentation"))!;
    (uploadSelect.props.onValueChange as (value: string) => void)("photograph"); fill(); click(button(WorkItemDetail, "Link record")); h.link.mock.calls[0][1].onSuccess();
    expect(render(WorkItemDetail).find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props.id === "test-upload-documentation"))!.props.value).toBe("photograph");
  });
});
