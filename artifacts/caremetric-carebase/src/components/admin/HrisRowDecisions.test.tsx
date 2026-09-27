import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0, key: null as unknown, effects: [] as Array<() => void | (() => void)>, rows: [] as any[], employees: {} as any, names: vi.fn(), decide: vi.fn(), toast: vi.fn(), onPending: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = initial; return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; }, useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); }, useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployeesByIds: (ids: string[]) => { h.names(ids); return h.employees; } }));
vi.mock("@/hooks/useHrisImportRuns", () => ({ HRIS_DECISIONS: ["create", "link", "skip", "reject"].map(value => ({ value, label: value })), useHrisImportRows: () => ({ data: h.rows, isLoading: false, isError: false, isFetching: false }), useSetHrisImportRowDecision: () => ({ mutateAsync: h.decide, isPending: false }) }));
import { HrisRowDecisions } from "./HrisRowDecisions";
type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : ""; }
let run: string;
function render() { h.cursor = 0; h.refCursor = 0; h.effects = []; const outer = HrisRowDecisions({ importRunId: run, onPendingChange: h.onPending }); if (outer.key !== h.key) { h.key = outer.key; h.state = []; h.refs = []; } return (outer.type as (props: any) => Element)(outer.props); }
function button(label: string) { const found = nodes(render()).find(n => typeof n.props.onClick === "function" && text(n).trim() === label); if (!found) throw Error(`Missing ${label}`); return found; }
function field(id: string) { return nodes(render()).find(n => n.props.id === id)!; }
function start() { button("Decide").props.onClick(); field("reason-row-1").props.onChange({ target: { value: "Reviewed duplicate evidence" } }); }
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.key = null; run = "run-A"; h.rows = [1, 2].map(i => ({ id: `row-${i}`, row_number: i, validation_status: "valid", merge_decision: null, candidate_employee_ids: ["candidate"] })); h.employees = { data: ["candidate", "new-candidate"].map(id => ({ id, first_name: "Casey", last_name: "Learner", employee_number: "EMP-42", email: "casey@example.test" })), isLoading: false, isError: false, refetch: vi.fn() }; });
describe("HRIS decision scope and recovery", () => {
  it("locks every row during a decision and rejects duplicate calls", async () => {
    const pending = deferred(); h.decide.mockReturnValue(pending.promise); start(); const save = button("Record decision").props.onClick; save(); save();
    expect(h.decide).toHaveBeenCalledExactlyOnceWith({ importRowId: "row-1", decision: "create", employeeId: null, reason: "Reviewed duplicate evidence" });
    expect(button("Decide").props.disabled).toBe(true); expect(button("Cancel").props.disabled).toBe(true);
    expect(nodes(render()).find(n => n.type === "fieldset")!.props.disabled).toBe(true);
    pending.resolve(); await pending.promise; await Promise.resolve(); expect(h.onPending.mock.calls.map(call => call[0])).toEqual([true, false]);
  });
  it("retains rejected input for explicit retry", async () => {
    const pending = deferred(); h.decide.mockReturnValue(pending.promise); start(); button("Record decision").props.onClick(); pending.reject(new Error("Decision unavailable"));
    await pending.promise.catch(() => undefined); await Promise.resolve(); expect(field("reason-row-1").props.value).toBe("Reviewed duplicate evidence"); expect(button("Record decision").props.disabled).toBe(false);
  });
  it.each(["success", "failure"])("isolates a new run from an old run's late %s", async outcome => {
    const pending = deferred(); h.decide.mockReturnValue(pending.promise); start(); const save = button("Record decision").props.onClick;
    const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function"); save(); cleanups.forEach(cleanup => cleanup());
    run = "run-B"; expect(nodes(render()).some(n => n.props.id === "reason-row-1")).toBe(false); start();
    if (outcome === "success") pending.resolve(); else pending.reject(new Error("Old run response"));
    await pending.promise.catch(() => undefined); await Promise.resolve(); expect(h.toast).not.toHaveBeenCalled(); expect(field("reason-row-1").props.value).toBe("Reviewed duplicate evidence");
  });
  it("blocks a linked employee removed by revalidation until another current candidate is chosen", () => {
    start(); nodes(render()).find(n => n.props.value === "create" && n.props.onValueChange)!.props.onValueChange("link");
    h.rows[0] = { ...h.rows[0], candidate_employee_ids: ["new-candidate"] };
    expect(button("Record decision").props.disabled).toBe(true); button("Record decision").props.onClick(); expect(h.decide).not.toHaveBeenCalled();
    nodes(render()).find(n => n.props.value === "candidate" && n.props.onValueChange)!.props.onValueChange("new-candidate"); expect(button("Record decision").props.disabled).toBe(false);
  });
  it("does not submit an old create choice when revalidation makes the row invalid", () => {
    start(); h.rows[0] = { ...h.rows[0], validation_status: "invalid" }; expect(button("Record decision").props.disabled).toBe(true);
    button("Record decision").props.onClick(); expect(h.decide).not.toHaveBeenCalled();
  });
  it("hides a stale editor after a recovered committed decision", () => {
    start(); h.rows[0] = { ...h.rows[0], merge_decision: "create" }; expect(nodes(render()).some(n => n.props.id === "reason-row-1")).toBe(false);
  });
  it("identifies duplicate candidates by authorized name, staff number and email without widening choices", () => {
    start(); nodes(render()).find(n => n.props.value === "create" && n.props.onValueChange)!.props.onValueChange("link");
    expect(text(render())).toContain("Casey Learner · EMP-42 · casey@example.test"); expect(h.names).toHaveBeenLastCalledWith(["candidate"]);
    expect(nodes(render()).some(n => n.props.value === "new-candidate")).toBe(false);
  });
  it("blocks decisions while candidate details fail or load and exposes a working retry", () => {
    start(); h.employees.isLoading = true; expect(button("Record decision").props.disabled).toBe(true);
    h.employees.isLoading = false; h.employees.isError = true; h.employees.error = new Error("Names unavailable");
    expect(button("Record decision").props.disabled).toBe(true); button("Record decision").props.onClick(); expect(h.decide).not.toHaveBeenCalled();
    nodes(render()).find(n => n.props.what === "duplicate candidate details")!.props.onRetry(); expect(h.employees.refetch).toHaveBeenCalledOnce();
  });
  it("labels an unavailable candidate explicitly and does not allow linking an unidentified employee", () => {
    start(); nodes(render()).find(n => n.props.value === "create" && n.props.onValueChange)!.props.onValueChange("link"); h.employees.data = [];
    expect(text(render())).toContain("Unknown or unavailable employee"); expect(button("Record decision").props.disabled).toBe(true);
    button("Record decision").props.onClick(); expect(h.decide).not.toHaveBeenCalled();
  });
});
