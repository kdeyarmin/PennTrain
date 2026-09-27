import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, cleanup: [] as (() => void)[], correctClass: vi.fn(), correctAttendee: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => {
  const state = (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial;
    return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; };
  return { ...await original<typeof import("react")>(), useState: state, useRef: (value: unknown) => state({ current: value })[0],
    useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) h.cleanup.push(cleanup); } };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useTrainingClasses", () => ({ useCorrectCompletedTrainingClass: () => ({ mutateAsync: h.correctClass }), useCorrectCompletedClassAttendee: () => ({ mutateAsync: h.correctAttendee }) }));
import CompletedClassCorrectionCard from "./CompletedClassCorrectionCard";
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children as ReactNode)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; return CompletedClassCorrectionCard({ classId: "class", className: "Orientation", location: "Room A", notes: "", attendees: [{ employee_id: "learner", name: "Casey", attended: false }] }); }
function button(label: string) { const node = nodes(render()).find(n => typeof n.props.onClick === "function" && text(n.props.children as ReactNode) === label); if (!node) throw Error(`Missing ${label}`); return node; }
function click(label: string) { return (button(label).props.onClick as () => unknown)(); }
function input(id: string, value: string) { const node = nodes(render()).find(n => n.props.id === id)!; (node.props.onChange as (event: unknown) => void)({ target: { value } }); }
function prepare() {
  click("Open corrections"); input("correct-class-location", "Room B"); input("correct-class-reason", "Verified original signed attendance roster");
  const select = nodes(render()).find(n => typeof n.props.onValueChange === "function")!;
  (select.props.onValueChange as (value: string) => void)("learner"); input("correct-attendee-reason", "Verified original signed attendance roster");
}
function deferred() { let resolve!: (value?: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.resetAllMocks(); h.state = []; h.cursor = 0; h.cleanup = []; });
describe("completed-class correction recovery", () => {
  it("serializes audit corrections and locks the draft until the first response settles", async () => {
    const pending = deferred(); h.correctClass.mockReturnValueOnce(pending.promise); prepare(); click("Correct class details"); click("Correct attendance");
    expect(h.correctClass).toHaveBeenCalledExactlyOnceWith({ classId: "class", patch: { location: "Room B" }, reason: "Verified original signed attendance roster" });
    expect(h.correctAttendee).not.toHaveBeenCalled();
    expect(button("Close").props.disabled).toBe(true);
    expect(nodes(render()).some(n => n.type === "fieldset" && n.props.disabled)).toBe(true);
    pending.resolve(); await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Class corrected" })));
    expect(nodes(render()).find(n => n.props.id === "correct-attendee-reason")!.props.value).toBe("Verified original signed attendance roster");
  });
  it("retains a rejected attendance correction for explicit retry", async () => {
    h.correctAttendee.mockRejectedValueOnce(new Error("Review required")); prepare(); click("Correct attendance");
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not correct the attendance" })));
    expect(nodes(render()).find(n => n.props.id === "correct-attendee-reason")!.props.value).toBe("Verified original signed attendance roster");
    expect(button("Correct attendance").props.disabled).not.toBe(true);
  });
  it.each(["success", "failure"])("ignores a late correction %s after leaving the class", async outcome => {
    const pending = deferred(); h.correctAttendee.mockReturnValueOnce(pending.promise); prepare(); click("Correct attendance");
    for (const cleanup of h.cleanup) cleanup();
    if (outcome === "success") pending.resolve(true); else pending.reject(new Error("Late failure"));
    await new Promise(resolve => setTimeout(resolve, 0)); expect(h.toast).not.toHaveBeenCalled();
  });
});
