import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ stores: {} as Record<string, unknown[]>, slots: [] as unknown[], cursor: 0, cleanup: undefined as undefined | (() => void), organization: "org-a" as string | null, rows: [] as any[], loading: false, error: false, fetching: false, pending: false, read: vi.fn(), retry: vi.fn(), mutate: vi.fn(), invalidate: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const slots = h.slots, index = h.cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = h.cursor++; return h.slots[index] ?? (h.slots[index] = { current: initial }); },
  useEffect: (effect: () => () => void) => { const index = h.cursor++; if (!(index in h.slots)) { h.slots[index] = true; h.cleanup = effect(); } },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "platform_admin", organizationId: null } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.organization }) }));
vi.mock("@/hooks/useEmployeeQualifications", () => ({ useEmployeeQualifications: (...args: unknown[]) => { h.read(...args); return { data: h.rows, isLoading: h.loading, isError: h.error, isFetching: h.fetching, error: new Error("Read failed"), refetch: h.retry }; } }));
vi.mock("@/hooks/useQualifiedWorkforce", () => ({ useQualifiedWorkforceCommand: () => ({ mutateAsync: h.mutate, isPending: h.pending }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/components/employees/EmployeeSearchSelect", () => ({ EmployeeSearchSelect: "employee-picker" }));
import { QualificationLifecycleCommand } from "./QualificationLifecycleCommand";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : []; }
function text(value: ReactNode): string { return Array.isArray(value) ? value.map(text).join("") : typeof value === "string" || typeof value === "number" ? String(value) : value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
let currentScope: unknown;
function render() {
  const outer = QualificationLifecycleCommand() as Node;
  if (outer.key !== currentScope) { h.cleanup?.(); h.cleanup = undefined; h.stores = {}; currentScope = outer.key; }
  h.slots = h.stores.workspace ?? (h.stores.workspace = []); h.cursor = 0;
  const workspace = (outer.type as (props: any) => Node)(outer.props);
  const child = nodes(workspace).find(node => typeof node.type === "function" && node.type.name === "QualificationDecision");
  if (!child) { h.cleanup?.(); h.cleanup = undefined; delete h.stores.decision; delete h.stores.decisionKey; return workspace; }
  if (String(child.key) !== String(h.stores.decisionKey?.[0])) { h.cleanup?.(); h.cleanup = undefined; h.stores.decision = []; h.stores.decisionKey = [child.key]; }
  h.slots = h.stores.decision; h.cursor = 0;
  return [workspace, (child.type as (props: any) => Node)(child.props)];
}
function field(id: string) { return nodes(render()).find(node => node.props.id === id)!; }
function chooseEmployee(id = "employee-a") { nodes(render()).find(node => node.type === "employee-picker")!.props.onValueChange(id); }
function selectById(id: string, value: string) { const tree = render(); const select = nodes(tree).find(node => typeof node.props.onValueChange === "function" && nodes(node.props.children).some(child => child.props.id === id))!; select.props.onValueChange(value); }
function reason(value = "Verified documentation") { field("qualification-reason").props.onChange({ target: { value } }); }
function button() { return nodes(render()).find(node => typeof node.props.onClick === "function" && ["Recording...", "Record state change"].includes(text(node))); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function open() { chooseEmployee(); selectById("qualification-record", "qualification-a"); }
beforeEach(() => {
  h.cleanup?.(); h.cleanup = undefined; vi.resetAllMocks(); h.invalidate.mockResolvedValue(undefined); h.mutate.mockResolvedValue(true); h.stores = {}; currentScope = null; h.organization = "org-a"; h.loading = false; h.error = false; h.fetching = false; h.pending = false;
  h.rows = [{ id: "qualification-a", employee_id: "employee-a", organization_id: "org-a", facility_id: "facility-a", state: "active", effective_to: null, effective_from: "2026-01-01T12:00:00Z", issued_at: "2026-01-01T12:00:00Z", expires_at: null, state_reason: null, definition: { name: "Medication administration", qualification_key: "medication.admin" }, version: { version_number: 2 }, facility: { name: "North residence" } }];
});
describe("qualification lifecycle reachability and submissions", () => {
  it("uses an organization-scoped employee picker including former staff and names the issued qualification", () => {
    const picker = nodes(render()).find(node => node.type === "employee-picker")!; expect(picker.props).toMatchObject({ organizationId: "org-a", status: "" });
    open(); expect(h.read).toHaveBeenLastCalledWith("employee-a", "org-a"); expect(text(render())).toContain("Medication administration v2 · North residence · active"); expect(text(render())).not.toContain("Qualification ID");
  });
  it("requires an organization and distinguishes no employee from an empty history", () => {
    h.organization = null; expect(text(render())).toContain("Select an organization"); expect(nodes(render()).some(node => node.type === "employee-picker")).toBe(false);
    h.organization = "org-a"; expect(text(render())).toContain("Choose an employee"); h.rows = []; chooseEmployee(); expect(text(render())).toContain("No qualification records");
  });
  it.each(["revoked", "closed"])("retains terminal %s evidence without offering mutation", kind => {
    if (kind === "revoked") h.rows[0].state = "revoked"; else h.rows[0].effective_to = "2027-01-01T12:00:00Z";
    open(); expect(text(render())).toContain("cannot be reopened"); expect(button()).toBeUndefined(); expect(h.mutate).not.toHaveBeenCalled();
  });
  it("keeps the server's allowed restoration of an unclosed expired record without changing dates", () => {
    h.rows[0].state = "expired"; open(); selectById("qualification-state", "active"); reason(); button()!.props.onClick();
    expect(h.mutate.mock.calls[0][0]).toEqual({ rpc: "set_employee_qualification_state", args: { p_qualification_id: "qualification-a", p_state: "active", p_reason: "Verified documentation" } });
  });
  it("serializes same-render clicks and awaits a failed-write refresh before allowing retry", async () => {
    const refresh = deferred(); h.invalidate.mockReturnValueOnce(refresh.promise); h.mutate.mockRejectedValueOnce(new Error("Server refused"));
    open(); reason(); const submit = button()!.props.onClick; const pending = submit(); submit(); expect(h.mutate).toHaveBeenCalledTimes(1);
    await Promise.resolve(); expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["qualified-workforce", "qualifications", "org-a", "employee-a"] });
    expect(button()!.props.disabled).toBe(true); button()!.props.onClick(); expect(h.mutate).toHaveBeenCalledTimes(1);
    refresh.resolve(); await pending;
    expect(field("qualification-reason").props.value).toBe("Verified documentation"); reason("Updated review evidence"); await button()!.props.onClick();
    expect(h.mutate.mock.calls[1][0].args.p_reason).toBe("Updated review evidence");
    expect(field("qualification-reason").props.value).toBe(""); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Qualification state recorded" }));
  });
  it.each(["success", "failure"])("does not attach an old employee's late %s to a replacement draft", async outcome => {
    const pending = deferred(); h.mutate.mockImplementationOnce(async () => { await pending.promise; if (outcome === "failure") throw new Error("Old failure"); return true; });
    open(); reason(); const save = button()!.props.onClick(); chooseEmployee("employee-b"); render();
    chooseEmployee(); selectById("qualification-record", "qualification-a"); reason("New review reason"); pending.resolve(); await save;
    expect(field("qualification-reason").props.value).toBe("New review reason"); expect(h.toast).not.toHaveBeenCalled();
  });
  it("freezes submitted fields and rechecks a terminal state after refresh", () => {
    open(); reason(); h.pending = true; expect(nodes(render()).find(node => node.type === "fieldset")!.props.disabled).toBe(true); button()!.props.onClick(); expect(h.mutate).not.toHaveBeenCalled();
    h.pending = false; h.rows[0] = { ...h.rows[0], state: "revoked" }; expect(button()).toBeUndefined();
  });
  it("blocks cached records during read failure and exposes retry without discarding the reason", () => {
    open(); reason(); h.error = true; const error = nodes(render()).find(node => node.props.what === "employee qualifications")!; error.props.onRetry(); expect(h.retry).toHaveBeenCalledOnce();
    expect(button()!.props.disabled).toBe(true); button()!.props.onClick(); expect(h.mutate).not.toHaveBeenCalled(); h.error = false; expect(field("qualification-reason").props.value).toBe("Verified documentation");
  });
  it.each(["loading", "fetching"] as const)("blocks stale actions during %s and preserves the same-record draft", phase => {
    open(); reason(); h[phase] = true; expect(button()!.props.disabled).toBe(true); button()!.props.onClick(); expect(h.mutate).not.toHaveBeenCalled();
    h[phase] = false; expect(field("qualification-reason").props.value).toBe("Verified documentation"); expect(button()!.props.disabled).toBe(false);
  });
  it("replaces employee and organization drafts, including A-to-B-to-A navigation", () => {
    open(); reason(); chooseEmployee("employee-b"); expect(button()).toBeUndefined(); chooseEmployee(); selectById("qualification-record", "qualification-a"); expect(field("qualification-reason").props.value).toBe("");
    reason(); h.organization = "org-b"; expect(button()).toBeUndefined(); h.organization = "org-a"; open(); expect(field("qualification-reason").props.value).toBe("");
  });
  it("preserves a same-record draft across refresh but blocks unchanged-state events", () => {
    open(); reason(); h.rows = [{ ...h.rows[0], state_reason: "Updated elsewhere" }]; expect(field("qualification-reason").props.value).toBe("Verified documentation");
    selectById("qualification-state", "active"); expect(button()!.props.disabled).toBe(true); button()!.props.onClick(); expect(h.mutate).not.toHaveBeenCalled();
  });
});
