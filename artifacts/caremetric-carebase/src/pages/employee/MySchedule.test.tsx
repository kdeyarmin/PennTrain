import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, cleanup: [] as (() => void)[],
  submit: vi.fn(), swap: vi.fn(), cancelSwap: vi.fn(), cancelTimeOff: vi.fn(), claim: vi.fn(), toast: vi.fn(), retry: vi.fn(),
  candidates: {} as Record<string, unknown>,
}));
vi.mock("react", async original => {
  const state = (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial;
    return [h.state[i], (value: unknown) => { h.state[i] = typeof value === "function" ? value(h.state[i]) : value; }]; };
  return { ...await original<typeof import("react")>(), useState: state, useRef: (value: unknown) => state({ current: value })[0],
    useId: () => "test", useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) h.cleanup.push(cleanup); } };
});
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => ({ data: { id: "employee", facility_id: "facility" } }) }));
vi.mock("@/hooks/useShiftAssignments", () => ({ useListShiftAssignments: () => ({ data: [
  { id: "own-shift", shift_date: "2027-01-10", start_time: "08:00", end_time: "16:00", status: "scheduled" },
] }) }));
vi.mock("@/hooks/useDailyOperations", () => ({
  useSubmitTimeOffRequest: () => ({ mutateAsync: h.submit }), useRequestShiftSwap: () => ({ mutateAsync: h.swap }),
  useCancelShiftSwapRequest: () => ({ mutateAsync: h.cancelSwap }), useCancelTimeOffRequest: () => ({ mutateAsync: h.cancelTimeOff }),
  useClaimOpenShift: () => ({ mutateAsync: h.claim }), useShiftSwapCandidates: () => h.candidates,
  useMyShiftSwapRequests: () => ({ data: [{ id: "swap-a" }, { id: "swap-b" }] }),
  useMyShiftWorkspace: () => ({ data: { employee: { facility_id: "facility" }, timeOffRequests: [], openShiftOffers: [] } }),
}));
import MySchedule from "./MySchedule";
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children as ReactNode)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; return MySchedule(); }
function button(label: string, tree = render()) { const node = nodes(tree).find(n => typeof n.props.onClick === "function" && text(n.props.children as ReactNode).trim() === label); if (!node) throw Error(`Missing ${label}`); return node; }
function click(label: string) { return (button(label).props.onClick as () => unknown)(); }
function input(id: string, value: string) { const node = nodes(render()).find(n => n.props.id === id)!; (node.props.onChange as (event: unknown) => void)({ target: { value } }); }
function timeOffDialog() { return nodes(render()).find(n => typeof n.props.onOpenChange === "function" && text(n).includes("Request time off"))!; }
function fillTimeOff() { click("Request time off"); input("time-off-start", "2027-01-10T08:00"); input("time-off-end", "2027-01-10T16:00"); input("time-off-reason", "Appointment"); }
function deferred() { let resolve!: (value?: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.cleanup = []; h.candidates = { data: [{ assignment_id: "coworker-shift", employee_name: "Coworker", shift_date: "2027-01-11", start_time: "08:00", end_time: "16:00" }], refetch: h.retry }; });

describe("schedule request recovery", () => {
  it("keeps a submitted time-off draft locked through settlement and prevents duplicate requests", async () => {
    const pending = deferred(); h.submit.mockReturnValueOnce(pending.promise); fillTimeOff();
    click("Submit request"); click("Submit request");
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(button("Request time off").props.disabled).toBe(true);
    expect(nodes(timeOffDialog()).some(n => n.type === "fieldset" && n.props.disabled)).toBe(true);
    (timeOffDialog().props.onOpenChange as (open: boolean) => void)(false);
    expect(timeOffDialog().props.open).toBe(true);
    pending.resolve(); await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Time-off request submitted" })));
    expect(timeOffDialog().props.open).toBe(false);
  });
  it("retains failed time-off input for retry instead of discarding the draft", async () => {
    h.submit.mockRejectedValueOnce(new Error("Request unavailable")); fillTimeOff(); click("Submit request");
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not submit request" })));
    expect(timeOffDialog().props.open).toBe(true);
    expect(nodes(render()).find(n => n.props.id === "time-off-reason")!.props.value).toBe("Appointment");
    expect(button("Submit request").props.disabled).toBe(false);
  });
  it.each(["success", "failure"])("suppresses a late time-off %s after leaving the page", async result => {
    const pending = deferred(); h.submit.mockReturnValueOnce(pending.promise); fillTimeOff(); click("Submit request");
    for (const cleanup of h.cleanup) cleanup();
    if (result === "success") pending.resolve(); else pending.reject(new Error("Late failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.toast).not.toHaveBeenCalled();
  });
  it("does not submit a stale swap candidate after its lookup fails and offers retry", () => {
    click("Request swap");
    const selection = nodes(render()).find(n => typeof n.props.onValueChange === "function")!;
    (selection.props.onValueChange as (value: string) => void)("coworker-shift"); input("swap-reason", "Family appointment");
    h.candidates = { ...h.candidates, isError: true, error: new Error("Eligibility unavailable") };
    expect(button("Submit swap").props.disabled).toBe(true);
    click("Submit swap"); expect(h.swap).not.toHaveBeenCalled();
    const error = nodes(render()).find(n => n.props.what === "shift swap candidates")!;
    expect(error).toBeDefined(); (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
  it("does not let an in-flight withdrawal replace the reason or target of a second request", async () => {
    const pending = deferred(); h.cancelSwap.mockReturnValueOnce(pending.promise); click("Withdraw");
    input("test-withdraw-swap-a", "Found another arrangement"); click("Confirm withdrawal");
    expect(button("Withdraw").props.disabled).toBe(true);
    expect(nodes(render()).find(n => n.props.id === "test-withdraw-swap-a")!.props.disabled).toBe(true);
    expect(button("Cancel").props.disabled).toBe(true);
    pending.resolve(); await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Swap request withdrawn" })));
  });
});
