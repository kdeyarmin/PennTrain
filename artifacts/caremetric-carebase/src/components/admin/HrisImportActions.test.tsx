import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HrisImportRun } from "@/hooks/useHrisImportRuns";
const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0, key: null as unknown, effects: [] as Array<() => void | (() => void)>, rows: [] as any[], queryError: false, command: vi.fn(), invalidate: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = initial; return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; }, useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); }, useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useHrisImportRuns", () => ({ useHrisImportRows: () => ({ data: h.rows, isLoading: false, isError: h.queryError, isFetching: false }) }));
vi.mock("@/hooks/useQualifiedWorkforce", () => ({ useQualifiedWorkforceCommand: () => ({ mutateAsync: h.command, isPending: false }) }));
vi.mock("./HrisRowDecisions", () => ({ HrisRowDecisions: () => null }));
import { HrisImportActions } from "./HrisImportActions";
type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : ""; }
let run: HrisImportRun;
function render() { h.cursor = 0; h.refCursor = 0; h.effects = []; const outer = HrisImportActions({ run }); if (outer.key !== h.key) { h.key = outer.key; h.state = []; h.refs = []; } return (outer.type as (props: any) => Element)(outer.props); }
function button(label: string) { return nodes(render()).find(n => typeof n.props.onClick === "function" && text(n).trim() === label)!; }
function deferred() { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.key = null; h.queryError = false; h.invalidate.mockResolvedValue(undefined); run = { id: "run-A", status: "validated" } as HrisImportRun; h.rows = [{ validation_status: "valid", merge_decision: "create", apply_status: "pending" }]; });
describe("HRIS run command meaning and scope", () => {
  it("reports partial batch failures with actual counts and recovery instead of complete success", async () => {
    h.command.mockResolvedValue({ applied: 98, skipped: 1, failed: 1 }); button("Apply next batch").props.onClick();
    await vi.waitFor(() => expect(text(render())).toContain("98 applied · 1 skipped or rejected · 1 failed"));
    expect(text(render())).toContain("Failed rows are not retried"); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Import batch needs review", variant: "destructive" }));
    expect(h.command).toHaveBeenCalledWith({ rpc: "apply_hris_import_batch", args: { p_import_run_id: "run-A", p_batch_size: 100 } });
  });
  it("serializes validate/apply against each other and row decisions through settlement", async () => {
    const pending = deferred(); h.command.mockReturnValue(pending.promise); const submit = button("Validate staged rows").props.onClick; submit(); submit();
    expect(h.command).toHaveBeenCalledTimes(1); expect(button("Apply next batch").props.disabled).toBe(true);
    expect(nodes(render()).find(n => n.props.importRunId)!.props.disabled).toBe(true);
    pending.resolve({ stagedCount: 2, invalidCount: 0, reviewCount: 1 }); await pending.promise; await Promise.resolve();
    const rowEditor = nodes(render()).find(n => n.props.importRunId)!; rowEditor.props.onPendingChange(true);
    expect(button("Validate staged rows").props.disabled).toBe(true); button("Validate staged rows").props.onClick(); expect(h.command).toHaveBeenCalledTimes(1);
  });
  it("blocks failed reads, undecided rows and retrying already failed rows", () => {
    h.queryError = true; expect(button("Apply next batch").props.disabled).toBe(true); button("Apply next batch").props.onClick();
    h.queryError = false; h.rows[0].merge_decision = null; expect(button("Apply next batch").props.disabled).toBe(true);
    h.rows[0].merge_decision = "create"; h.rows[0].apply_status = "failed"; expect(button("Apply next batch").props.disabled).toBe(true);
    expect(h.command).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"])("does not attach old run %s to a new run", async outcome => {
    const pending = deferred(); h.command.mockReturnValue(pending.promise); const save = button("Apply next batch").props.onClick;
    const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function"); save(); cleanups.forEach(cleanup => cleanup());
    run = { ...run, id: "run-B" }; render(); if (outcome === "success") pending.resolve({ applied: 1, skipped: 0, failed: 0 }); else pending.reject(new Error("Old failed request"));
    await pending.promise.catch(() => undefined); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.toast).not.toHaveBeenCalled(); expect(text(render())).not.toContain("Old failed request"); expect(text(render())).not.toContain("1 applied");
  });
  it("refreshes uncertain writes before enabling a retry and presents the error", async () => {
    h.command.mockRejectedValue(new Error("Connection interrupted")); button("Apply next batch").props.onClick();
    await vi.waitFor(() => expect(text(render())).toContain("Connection interrupted"));
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["hris-import-rows", "run-A"] }); expect(button("Apply next batch").props.disabled).toBe(false);
  });
  it("does not describe a malformed response as a completed import", async () => {
    h.command.mockResolvedValue(null); button("Apply next batch").props.onClick(); await vi.waitFor(() => expect(text(render())).toContain("did not include a complete import summary")); expect(h.toast).not.toHaveBeenCalled();
  });
});
