import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0, effects: [] as Array<() => void | (() => void)>, sources: {} as any, runs: {} as any, org: "org-A", createRun: vi.fn(), createSource: vi.fn(), started: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "test", useState: (initial: unknown) => { const state = h.state, i = h.cursor++; if (!(i in state)) state[i] = initial; return [state[i], (next: unknown) => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; }, useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); }, useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useHrisImportRuns", async original => ({ ...await original<typeof import("@/hooks/useHrisImportRuns")>(), useHrisSourceSystems: () => h.sources, useHrisImportRuns: () => h.runs, useCreateHrisImportRun: () => ({ mutateAsync: h.createRun, isPending: false }), useCreateHrisSourceSystem: () => ({ mutateAsync: h.createSource, isPending: false }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { organizationId: null } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.org }) }));
vi.mock("@/hooks/useQualifiedWorkforce", () => ({ useQualifiedWorkforce: () => ({ data: {}, isLoading: false, isError: false }), useQualifiedWorkforceCommand: vi.fn() }));
import QualifiedWorkforce from "@/pages/admin/QualifiedWorkforce";
import { HrisSourceSystems } from "./HrisSourceSystems";
type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : ""; }
function component(tree: ReactNode, name: string) { return nodes(tree).find(n => typeof n.type === "function" && n.type.name === name)!; }
function invoke(node: Element) { return (node.type as (props: any) => Element)(node.props); }
function resetHooks() { h.cursor = 0; h.refCursor = 0; h.effects = []; }
function workspace() { return invoke(component(QualifiedWorkforce(), "HrisCommands")); }
let startComponent: Element;
function renderStart() { resetHooks(); return invoke({ ...startComponent, props: { ...startComponent.props, organizationId: h.org, onStarted: h.started } }); }
function renderSource() { resetHooks(); return invoke(HrisSourceSystems({ organizationId: h.org })); }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => typeof n.props.onClick === "function" && text(n).trim() === label)!; }
function field(tree: ReactNode, id: string) { return nodes(tree).find(n => n.props.id === id)!; }
function startDraft() { nodes(renderStart()).find(n => n.props.onValueChange)!.props.onValueChange("source"); field(renderStart(), "phase3-request").props.onChange({ target: { value: "extract-key-2027" } }); }
function sourceDraft() { field(renderSource(), "test-key").props.onChange({ target: { value: "workday" } }); field(renderSource(), "test-name").props.onChange({ target: { value: "Workday roster" } }); }
function deferred() { let resolve!: (value?: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; resetHooks(); h.org = "org-A";
  h.sources = { data: [{ id: "source", source_key: "workday", display_name: "Workday", status: "pilot" }], isLoading: false, isError: false };
  h.runs = { data: [{ id: "run-A", status: "validated" }], isLoading: false, isFetching: false, isError: false };
  startComponent = component(invoke(workspace()), "StartImportRunCard"); h.state = []; h.refs = []; resetHooks();
});
describe("HRIS source and run capture", () => {
  it("selects a created run when the user has not replaced the selection", async () => {
    startDraft(); h.createRun.mockResolvedValueOnce("new-run"); await button(renderStart(), "Start run").props.onClick();
    expect(h.started).toHaveBeenCalledExactlyOnceWith("new-run"); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Import run started" }));
  });
  it.each([
    ["success", ["run-B"]], ["failure", ["run-B"]],
    ["success", ["run-B", "run-A"]], ["failure", ["run-B", "run-A"]],
  ] as const)("preserves a newer same-organization run selection after delayed start %s through %j", async (outcome, selections) => {
    h.runs.data.push({ id: "run-B", status: "validated" });
    const outer = workspace(), parent = { state: [] as any[], refs: [] as any[] }, starter = { state: [] as any[], refs: [] as any[] };
    const renderParent = () => { h.state = parent.state; h.refs = parent.refs; resetHooks(); return invoke(outer); };
    const pickRun = (id: string) => nodes(renderParent()).find(n => n.props.onValueChange)!.props.onValueChange(id);
    pickRun("run-A"); const start = component(renderParent(), "StartImportRunCard");
    const renderCard = () => { h.state = starter.state; h.refs = starter.refs; resetHooks(); return invoke(start); };
    nodes(renderCard()).find(n => n.props.onValueChange)!.props.onValueChange("source");
    field(renderCard(), "phase3-request").props.onChange({ target: { value: "new-extract" } });
    const pending = deferred(); h.createRun.mockReturnValue(pending.promise);
    const task = button(renderCard(), "Start run").props.onClick();
    for (const selection of selections) pickRun(selection);
    const chosenActions = component(renderParent(), "HrisImportActions");
    expect(chosenActions.props.run.id).toBe(selections.at(-1));
    if (outcome === "success") pending.resolve("new-run"); else pending.reject(new Error("Old start failed"));
    await task;
    const settledActions = component(renderParent(), "HrisImportActions");
    expect(settledActions?.props.run.id).toBe(chosenActions.props.run.id);
    expect(settledActions?.type).toBe(chosenActions.type);
    expect(h.toast).not.toHaveBeenCalled();
  });
  it("isolates the full import workspace when the viewed organization changes", () => { const first = workspace(); h.org = "org-B"; const second = workspace(); expect(first.key).not.toBe(second.key); });
  it("does not make arbitrary or missing runs actionable", () => {
    const outer = workspace(); resetHooks(); let tree = invoke(outer);
    nodes(tree).find(n => n.props.onValueChange)!.props.onValueChange("foreign-run"); resetHooks(); tree = invoke(outer);
    expect(component(tree, "HrisImportActions")).toBeUndefined();
  });
  it("blocks a stale source after a failed picker read", async () => {
    startDraft(); h.sources.isError = true; const save = button(renderStart(), "Start run"); expect(save.props.disabled).toBe(true); await save.props.onClick(); expect(h.createRun).not.toHaveBeenCalled();
  });
  it("locks a captured start request and keeps its idempotency key on failure", async () => {
    const pending = deferred(); h.createRun.mockReturnValue(pending.promise); startDraft(); const save = button(renderStart(), "Start run").props.onClick;
    const task = save(); await save(); expect(h.createRun).toHaveBeenCalledExactlyOnceWith({ sourceSystemId: "source", requestId: "extract-key-2027" });
    expect(field(renderStart(), "phase3-request").props.disabled).toBe(true); pending.reject(new Error("Lost start response")); await task;
    expect(field(renderStart(), "phase3-request").props.value).toBe("extract-key-2027"); expect(button(renderStart(), "Start run").props.disabled).toBe(false);
  });
  it.each(["success", "failure"])("does not select a run or toast after old start %s finishes after unmount", async outcome => {
    const pending = deferred(); h.createRun.mockReturnValue(pending.promise); startDraft(); const save = button(renderStart(), "Start run").props.onClick;
    const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function"); const task = save(); cleanups.forEach(cleanup => cleanup());
    if (outcome === "success") pending.resolve("old-run"); else pending.reject(new Error("Old run error")); await task;
    expect(h.started).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("locks source registration and retains the failed draft", async () => {
    const pending = deferred(); h.createSource.mockReturnValue(pending.promise); sourceDraft(); const save = button(renderSource(), "Register source system").props.onClick; save(); save();
    expect(h.createSource).toHaveBeenCalledTimes(1); expect(nodes(renderSource()).find(n => n.type === "fieldset")!.props.disabled).toBe(true);
    pending.reject(new Error("Source unavailable")); await pending.promise.catch(() => undefined); await Promise.resolve();
    expect(field(renderSource(), "test-name").props.value).toBe("Workday roster"); expect(button(renderSource(), "Register source system").props.disabled).toBe(false);
  });
  it("suppresses source completion feedback after leaving the old organization", async () => {
    const pending = deferred(); h.createSource.mockReturnValue(pending.promise); sourceDraft(); const save = button(renderSource(), "Register source system").props.onClick;
    const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function"); save(); cleanups.forEach(cleanup => cleanup());
    pending.resolve(); await pending.promise; await Promise.resolve(); expect(h.toast).not.toHaveBeenCalled();
  });
});
