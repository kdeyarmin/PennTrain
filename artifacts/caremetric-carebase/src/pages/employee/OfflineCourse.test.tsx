import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, dirty: false,
  effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), pending: [] as Array<() => void>,
  progress: {} as Record<string, unknown>, queue: vi.fn(), sync: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => {
  const state = (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; h.dirty ||= value !== h.state[index]; h.state[index] = value; }]; };
  return { ...await original<typeof import("react")>(), useState: state, useRef: (value: unknown) => state({ current: value })[0], useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const index = h.cursor++, previous = h.effects.get(index);
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      h.pending.push(() => { previous?.cleanup?.(); const cleanup = fn(); h.effects.set(index, { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined }); }); },
  };
});
vi.mock("wouter", () => ({ useParams: () => ({ assignmentId: "assignment" }), Link: "a" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useCourseVideoUrl", () => ({ useCourseVideoUrl: () => ({ url: null }) }));
vi.mock("@/hooks/useOfflineLearning", () => {
  const record = { downloadedAt: "2026-09-26T12:00:00Z" };
  const bundle = { data: { assignment: { id: "assignment", serverBaseVersion: 3 }, course: { title: "Offline lesson" }, blocks: ["first", "second"].map(id => ({ id, type: "text", title: id, body: { content: "Read this lesson" } })) } };
  return { useOfflineCourseBundle: () => ({ data: { record, bundle } }), useOfflineProgress: () => h.progress,
    useQueueOfflineProgress: () => ({ mutateAsync: h.queue }), useSyncOfflineProgress: () => ({ mutateAsync: h.sync }), useRemoveOfflineCourse: () => ({ mutateAsync: vi.fn() }) };
});
import OfflineCourse from "./OfflineCourse";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { let tree: ReactNode; for (let pass = 0; pass < 6; pass++) { h.cursor = 0; h.dirty = false; h.pending = []; tree = OfflineCourse(); for (const effect of h.pending) effect(); if (!h.dirty) return tree; } throw new Error("Render did not settle"); }
beforeEach(() => { vi.resetAllMocks(); h.state = []; h.effects = new Map(); h.progress = { data: null }; h.queue.mockResolvedValue({});
  vi.stubGlobal("navigator", { onLine: false }); vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => { for (const effect of h.effects.values()) effect.cleanup?.(); vi.unstubAllGlobals(); });
describe("offline first lesson checkpoint", () => {
  it("saves the first displayed lesson while disconnected without requiring a navigation click", async () => {
    render(); await Promise.resolve();
    expect(h.queue).toHaveBeenCalledExactlyOnceWith({ assignmentId: "assignment", percentComplete: 50, baseVersion: 3, lastBlockId: "first" });
    render(); expect(h.queue).toHaveBeenCalledOnce(); expect(h.sync).not.toHaveBeenCalled();
  });
  it("waits for saved progress before resuming and never replaces an existing checkpoint", () => {
    h.progress = { isLoading: true }; expect(text(render())).toContain("Loading your saved offline progress"); expect(h.queue).not.toHaveBeenCalled();
    h.progress = { data: { percentComplete: 100, syncedPercent: 50 } }; expect(text(render())).toContain("Lesson 2 of 2"); expect(h.queue).not.toHaveBeenCalled();
  });
  it("reports initial storage failure and leaves the manual checkpoint retry usable", async () => {
    h.queue.mockRejectedValueOnce(new Error("Device storage unavailable")); render(); await Promise.resolve(); await Promise.resolve();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Progress could not be saved on this device", description: "Device storage unavailable" }));
    const retry = nodes(render()).find(node => text(node).trim() === "Save 50% checkpoint" && node.props.onClick)!;
    expect(retry.props.disabled).toBeFalsy(); (retry.props.onClick as () => void)(); await Promise.resolve();
    expect(h.queue).toHaveBeenCalledTimes(2);
  });
  it("reports a delayed first-save rejection after a pending render changes the mutation callback", async () => {
    let reject!: (error: Error) => void;
    h.queue.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render();
    const originalQueue = h.queue;
    h.queue = vi.fn((...args) => originalQueue(...args));
    expect(h.queue).not.toBe(originalQueue);
    render();
    reject(new Error("Device storage filled during save"));
    await Promise.resolve(); await Promise.resolve();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Progress could not be saved on this device", description: "Device storage filled during save" }));
    expect(originalQueue).toHaveBeenCalledOnce();
  });
  it("does not show a late first-save error after the learner leaves the offline reader", async () => {
    let reject!: (error: Error) => void;
    h.queue.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render();
    for (const effect of h.effects.values()) effect.cleanup?.();
    reject(new Error("Device storage unavailable"));
    await Promise.resolve(); await Promise.resolve();
    expect(h.toast).not.toHaveBeenCalled();
  });
});
