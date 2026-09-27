import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[],
  status: "draft",
  save: vi.fn(), summary: vi.fn(), finalize: vi.fn(), refetch: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "assessment",
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial;
    return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = h.cursor++;
    return h.slots[index] ??= { current: initial };
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = h.cursor++; const previous = h.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) {
      h.slots[index] = deps;
      h.effects.push(() => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup); });
    }
  },
}));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/app/residents/resident/assessments/form"], useParams: () => ({ residentId: "resident", formId: "form" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", firstName: "Care", lastName: "Manager" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidents", () => ({ useGetResident: () => ({ data: undefined }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useListResidentDocuments: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentAssessmentForms", () => ({
  useGetResidentAssessmentForm: () => ({ data: { id: "form", form_type: "RASP", status: h.status, content: {}, reason: "initial", version: 1 }, refetch: h.refetch }),
  useSaveResidentAssessmentFormDraft: () => ({ mutateAsync: h.save, isPending: false }),
  useGenerateResidentAssessmentSummary: () => ({ mutate: h.summary, isPending: false }),
  useFinalizeResidentAssessmentForm: () => ({ mutate: h.finalize, isPending: false }),
  useGenerateResidentAssessmentFormPdf: () => ({ mutate: vi.fn(), isPending: false }),
}));
import Editor from "./ResidentAssessmentFormEditor";
import { SummaryTab } from "./resident-assessment-form-tabs/SummaryTab";
import type { ResidentAssessmentFormContent } from "@/lib/residentAssessmentFormSchema";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function render() {
  h.cursor = 0; let result = Editor();
  if (h.effects.length) {
    const effects = h.effects.splice(0); effects.forEach(effect => effect());
    h.cursor = 0; result = Editor();
  }
  return result;
}
function summary() { return nodes(render()).find(node => node.type === SummaryTab)!.props as unknown as Parameters<typeof SummaryTab>[0]; }
function edit(value: string) {
  const props = summary(); props.update({ ...props.content, summary: { overallWellness: value } });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function finalize() {
  const button = nodes(render()).find(node => typeof node.props.onClick === "function" && String(node.props.children).startsWith("Finalize "))!;
  return (button.props.onClick as () => Promise<void>)();
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.status = "draft";
  vi.clearAllMocks(); h.save.mockReset().mockResolvedValue(undefined); h.refetch.mockReset().mockResolvedValue({});
  vi.useFakeTimers(); vi.stubGlobal("window", { sessionStorage: { getItem: () => null, setItem: vi.fn() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("assessment draft persistence", () => {
  it("serializes the AI flush behind an older autosave and generates only after the latest snapshot saves", async () => {
    const older = deferred(); h.save.mockImplementationOnce(() => older.promise);
    edit("older"); await vi.advanceTimersByTimeAsync(1500);
    edit("latest"); const generating = summary().handleGenerateWellnessSummary(); await drain();
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.summary).not.toHaveBeenCalled();
    older.resolve(); await generating;
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].content.summary.overallWellness).toBe("latest");
    expect(h.summary).toHaveBeenCalledTimes(1);
  });
  it("locks the generation snapshot, prevents competing actions, then autosaves the generated summary", async () => {
    const saved = deferred(); h.save.mockImplementationOnce(() => saved.promise);
    edit("reviewed snapshot"); const generating = summary().handleGenerateWellnessSummary(); await drain();
    expect(summary().isReadOnly).toBe(true); edit("unsaved replacement");
    expect(summary().content.summary.overallWellness).toBe("reviewed snapshot");
    await summary().handleGenerateWellnessSummary(); expect(h.save).toHaveBeenCalledTimes(1);
    saved.resolve(); await generating;
    h.summary.mock.calls[0][1].onSuccess({ summary: "Generated draft", suggested_additions: [], follow_up_questions: [] });
    h.summary.mock.calls[0][1].onSettled();
    expect(summary().isReadOnly).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.save.mock.calls[1][0].content.summary.overallWellness).toBe("Generated draft");
  });
  it("refuses generation after a failed save and restores editing without losing the draft", async () => {
    h.save.mockRejectedValueOnce(new Error("Save failed")); edit("must keep this");
    await summary().handleGenerateWellnessSummary();
    expect(h.summary).not.toHaveBeenCalled(); expect(summary().isReadOnly).toBe(false);
    expect(summary().content.summary.overallWellness).toBe("must keep this");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save latest changes before generating" }));
  });
  it("freezes fields through save, finalization and the final status refresh", async () => {
    const saved = deferred(); const refreshed = deferred();
    h.save.mockImplementationOnce(() => saved.promise); h.refetch.mockReturnValueOnce(refreshed.promise);
    edit("final snapshot"); const oldUpdate = summary().update; const pending = finalize(); await drain();
    expect(summary().isReadOnly).toBe(true);
    oldUpdate({ ...summary().content, summary: { overallWellness: "late edit" } } as ResidentAssessmentFormContent);
    expect(summary().content.summary.overallWellness).toBe("final snapshot");
    saved.resolve(); await pending; expect(h.finalize).toHaveBeenCalledTimes(1);
    h.finalize.mock.calls[0][1].onError(new Error("PDF creation failed after finalization"));
    const settled = h.finalize.mock.calls[0][1].onSettled(); await drain();
    expect(summary().isReadOnly).toBe(true);
    h.status = "finalized"; refreshed.resolve(); await settled; expect(summary().isReadOnly).toBe(true);
  });
  it("does not finalize after a failed flush and returns the intact draft to editing", async () => {
    h.save.mockRejectedValueOnce(new Error("Offline")); edit("retain on failure");
    await finalize();
    expect(h.finalize).not.toHaveBeenCalled(); expect(summary().isReadOnly).toBe(false);
    expect(summary().content.summary.overallWellness).toBe("retain on failure");
  });
  it("reports a failed navigation flush instead of leaving an unhandled rejected save", async () => {
    h.save.mockRejectedValueOnce(new Error("Offline")); edit("leaving draft");
    h.cleanups.forEach(cleanup => cleanup()); await drain();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save changes", description: "Offline" }));
  });
});
