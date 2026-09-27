import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, cursor: 0, refCursor: 0, dirty: false,
  effects: [] as Array<() => unknown>, cleanups: [] as Array<() => unknown>, seenEffects: [] as boolean[], effectCursor: 0,
  org: "org-a", user: { id: "operator", role: "platform_admin", organizationId: null as string | null },
  facilities: {} as Record<string, unknown>, list: vi.fn(), command: vi.fn(), toast: vi.fn(), retry: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "eligibility",
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial; return [h.state[i], (next: unknown) => { const value = typeof next === "function" ? next(h.state[i]) : next; if (!Object.is(value, h.state[i])) h.dirty = true; h.state[i] = value; }]; },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown) => { const i = h.effectCursor++; if (!h.seenEffects[i]) { h.effects.push(() => { const cleanup = effect(); if (typeof cleanup === "function") h.cleanups.push(cleanup as () => unknown); }); h.seenEffects[i] = true; } },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.org }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: (...args: unknown[]) => { h.list(...args); return h.facilities; } }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useAssignableFacilities: (rows: unknown) => rows ?? [] }));
vi.mock("@/hooks/useQualifiedWorkforce", () => ({ useQualifiedWorkforce: () => ({ data: {} }), useQualifiedWorkforceCommand: () => ({ mutateAsync: h.command, isPending: false }) }));
import QualifiedWorkforce from "./QualifiedWorkforce";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : []; }
function render() {
  for (let pass = 0; pass < 12; pass++) {
    h.cursor = h.refCursor = h.effectCursor = 0; h.dirty = false; h.effects = [];
    const component = nodes(QualifiedWorkforce()).find(n => typeof n.type === "function" && n.type.name === "EligibilityCommand")!;
    const tree = nodes((component.type as () => ReactNode)()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Eligibility did not settle");
}
const field = (id: string) => render().find(n => n.props.id === `phase3-${id}`)!;
const change = (id: string, value: string) => field(id).props.onChange({ target: { value } });
const employee = (id: string) => render().find(n => n.props.label === "Employee")!.props.onValueChange(id);
const facility = (id: string) => render().find(n => n.props.onValueChange && nodes(n.props.children).some(c => c.props.id === "phase3-facility"))!.props.onValueChange(id);
const button = () => render().find(n => n.props.children === "Evaluate eligibility")!;
const verdict = () => render().find(n => typeof n.type === "function" && n.type.name === "EligibilityResultView");
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function draft() { facility("facility-a"); employee("employee-a"); change("start", "2026-09-27T09:00"); change("end", "2026-09-27T17:00"); change("required", "cpr, medication.administration"); }
function deferred() { let resolve!: (data: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.cleanups = []; h.seenEffects = []; h.org = "org-a"; h.user = { id: "operator", role: "platform_admin", organizationId: null };
  h.facilities = { data: [{ id: "facility-a", name: "Facility A", organization_id: "org-a" }, { id: "facility-b", name: "Facility B", organization_id: "org-a" }], isSuccess: true, isLoading: false, isError: false, isFetching: false, error: new Error("Read unavailable"), refetch: h.retry };
  h.command.mockResolvedValue({ outcome: "eligible", sourceChecksumSha256: "saved" });
});
describe("schedule eligibility request identity", () => {
  it("uses the viewed organization for both employee and facility choices", () => {
    expect(render().find(n => n.props.label === "Employee")!.props.organizationId).toBe("org-a");
    expect(h.list).toHaveBeenLastCalledWith({ organizationId: "org-a" });
  });
  it.each(["employee", "facility", "start", "end", "required"])("retires a completed verdict after changing %s", async changed => {
    draft(); button().props.onClick(); await flush(); expect(verdict()).toBeDefined();
    if (changed === "employee") employee("employee-b"); else if (changed === "facility") facility("facility-b"); else change(changed, changed === "required" ? "new.key" : "2026-09-28T09:00");
    expect(verdict()).toBeUndefined();
  });
  it.each(["success", "failure"])("ignores an old %s after changing input away and back", async outcome => {
    draft(); const pending = deferred(); h.command.mockReturnValueOnce(pending.promise); button().props.onClick();
    change("required", "other"); change("required", "cpr, medication.administration");
    if (outcome === "success") pending.resolve({ outcome: "eligible" }); else pending.reject(new Error("Old failure")); await flush();
    expect(verdict()).toBeUndefined(); expect(h.toast).not.toHaveBeenCalled();
  });
  it.each(["organization", "actor", "unmount"])("retires a pending verdict after %s replacement", async changeScope => {
    draft(); const pending = deferred(); h.command.mockReturnValueOnce(pending.promise); button().props.onClick();
    if (changeScope === "unmount") h.cleanups.forEach(cleanup => cleanup()); else { if (changeScope === "organization") h.org = "org-b"; else h.user.id = "new-operator"; render(); }
    pending.resolve({ outcome: "eligible" }); await flush(); expect(verdict()).toBeUndefined();
    if (changeScope !== "unmount") { expect(render().find(n => n.props.label === "Employee")!.props.value).toBe(""); expect(field("facility")).toBeDefined(); }
  });
  it("serializes duplicate submissions and preserves the actual evaluation contract", async () => {
    draft(); const pending = deferred(); h.command.mockReturnValueOnce(pending.promise); const submit = button().props.onClick; submit(); submit();
    expect(h.command).toHaveBeenCalledExactlyOnceWith({ rpc: "evaluate_schedule_eligibility", args: { p_employee_id: "employee-a", p_facility_id: "facility-a", p_starts_at: "2026-09-27T13:00:00.000Z", p_ends_at: "2026-09-27T21:00:00.000Z", p_required_qualification_keys: ["cpr", "medication.administration"], p_required_credential_types: [], p_required_training_type_ids: [], p_exclude_assignment_ids: [] } });
    expect(button().props.disabled).toBe(true); pending.resolve({ outcome: "blocked" }); await flush(); expect(verdict()?.props.result.outcome).toBe("blocked");
  });
  it("retains valid inputs and allows retry after the current evaluation fails", async () => {
    draft(); h.command.mockRejectedValueOnce(new Error("Retry evaluation")); button().props.onClick(); await flush();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Eligibility evaluation blocked" })); expect(field("start").props.value).toBe("2026-09-27T09:00"); expect(button().props.disabled).toBe(false);
    button().props.onClick(); await flush(); expect(verdict()).toBeDefined();
  });
  it.each(["2026-02-30T09:00", "2026-03-08T02:30", "10000-01-01T09:00", "2026-09-27T24:00", "2026-09-27T17:00", "2026-09-28T09:00"])("does not evaluate invalid/nonpositive interval starting %s", value => {
    draft(); change("start", value); expect(button().props.disabled).toBe(true); button().props.onClick(); expect(h.command).not.toHaveBeenCalled();
    expect(render().some(n => n.props.role === "alert")).toBe(true);
  });
  it.each(["error", "fetching", "removed"])("blocks a facility that is %s and offers error recovery", state => {
    draft(); if (state === "error") { h.facilities.isSuccess = false; h.facilities.isError = true; } else if (state === "fetching") h.facilities.isFetching = true; else h.facilities.data = [];
    expect(button().props.disabled).toBe(true); button().props.onClick(); expect(h.command).not.toHaveBeenCalled();
    if (state === "error") { const failure = render().find(n => n.props.what === "eligibility facilities")!; expect(failure).toBeDefined(); failure.props.onRetry(); expect(h.retry).toHaveBeenCalledOnce(); }
  });
});
