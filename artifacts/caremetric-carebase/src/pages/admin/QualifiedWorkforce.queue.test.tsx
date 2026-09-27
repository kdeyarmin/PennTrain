import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as any[], refs: [] as any[], cursor: 0, refCursor: 0, key: null as unknown, effects: [] as Array<() => void | (() => void)>, org: "org-A", queue: {} as any, facilities: {} as any, query: vi.fn(), decide: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "queue", useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = initial; return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; }, useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ?? (h.refs[i] = { current: initial }); }, useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); } }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { organizationId: null, role: "platform_admin" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.org }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => h.facilities }));
vi.mock("@/hooks/useQualifiedWorkforce", () => ({ useQualifiedWorkforce: () => ({ data: {}, isLoading: false }), useQualifiedWorkforceCommand: vi.fn() }));
vi.mock("@/hooks/useDailyOperations", () => ({ useWorkforceSelfServiceQueues: (...args: unknown[]) => { h.query(...args); return h.queue; }, useDecideTimeOffRequest: () => ({ mutateAsync: h.decide, isPending: false }), useDecideOpenShiftClaim: () => ({ mutateAsync: h.decide, isPending: false }), useDecideShiftSwap: () => ({ mutateAsync: h.decide, isPending: false }) }));
import QualifiedWorkforce from "./QualifiedWorkforce";
type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : ""; }
function render() { h.cursor = 0; h.refCursor = 0; h.effects = []; const component = nodes(QualifiedWorkforce()).find(n => typeof n.type === "function" && n.type.name === "WorkforceSelfServiceQueue")!; const outer = (component.type as () => Element)(); if (outer.key !== h.key) { h.key = outer.key; h.state = []; h.refs = []; } return (outer.type as (props: any) => Element)(outer.props); }
function buttons(label: string) { return nodes(render()).filter(n => typeof n.props.onClick === "function" && text(n).trim() === label); }
function field() { return nodes(render()).find(n => n.props.id === "queue-decision-reason")!; }
function dialog() { return nodes(render()).find(n => typeof n.props.onOpenChange === "function")!; }
function prepare(index = 0) { buttons("Approve")[index].props.onClick(); field().props.onChange({ target: { value: "Reviewed current coverage" } }); }
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
async function flush() { for (let step = 0; step < 6; step++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.key = null; h.org = "org-A"; h.facilities = { data: [{ id: "facility", organization_id: "org-A", name: "Facility" }], isLoading: false, isError: false }; h.queue = { data: { timeOff: [1, 2].map(i => ({ id: `request-${i}`, starts_at: "2027-10-01", ends_at: "2027-10-02" })), openShiftClaims: [{ id: "claim" }], shiftSwaps: [{ id: "swap", expires_at: "2999-01-01" }] }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue({ isError: false }) }; });
describe("workforce request decision recovery", () => {
  it.each([0, 2, 3])("locks and serializes request kind %s without replacing the captured decision", async index => {
    const pending = deferred(); h.decide.mockReturnValue(pending.promise); prepare(index); const submit = buttons("Record decision")[0].props.onClick; submit(); submit();
    expect(h.decide).toHaveBeenCalledTimes(1); expect(field().props.disabled).toBe(true); expect(buttons("Cancel")[0].props.disabled).toBe(true);
    dialog().props.onOpenChange(false); buttons("Approve")[1].props.onClick(); expect(dialog().props.open).toBe(true); expect(field().props.value).toBe("Reviewed current coverage");
    expect(h.decide.mock.calls[0][0]).toEqual(index === 0 ? { requestId: "request-1", status: "approved", reason: "Reviewed current coverage" } : index === 2 ? { claimId: "claim", approve: true, reason: "Reviewed current coverage" } : { requestId: "swap", approve: true, reason: "Reviewed current coverage" });
    pending.resolve(); await pending.promise; await Promise.resolve(); expect(dialog().props.open).toBe(false);
  });
  it("retains a blocked request and reason for retry", async () => {
    const pending = deferred(); h.decide.mockReturnValue(pending.promise); prepare(); buttons("Record decision")[0].props.onClick(); pending.reject(new Error("Approval unavailable")); await pending.promise.catch(() => undefined); await Promise.resolve();
    expect(dialog().props.open).toBe(true); expect(field().props.value).toBe("Reviewed current coverage"); expect(buttons("Record decision")[0].props.disabled).toBe(false);
  });
  it.each(["success", "failure"])("suppresses old %s feedback after leaving the queue", async outcome => {
    const pending = deferred(); h.decide.mockReturnValue(pending.promise); prepare(); const save = buttons("Record decision")[0].props.onClick; const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function"); save(); cleanups.forEach(cleanup => cleanup());
    if (outcome === "success") pending.resolve(); else pending.reject(new Error("Old decision error")); await pending.promise.catch(() => undefined); await Promise.resolve(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("blocks approval after a swap expires while its decision is open, retaining rejection", () => {
    prepare(3); h.queue.data.shiftSwaps[0].expires_at = "2000-01-01"; buttons("Record decision")[0].props.onClick(); expect(h.decide).not.toHaveBeenCalled(); expect(text(render())).toContain("This swap has expired");
    buttons("Cancel")[0].props.onClick(); expect(buttons("Reject")).toHaveLength(2);
  });
  it("blocks a request removed by refresh instead of acting on stale selection", () => {
    prepare(); h.queue.data.timeOff = []; expect(buttons("Record decision")[0].props.disabled).toBe(true); buttons("Record decision")[0].props.onClick(); expect(h.decide).not.toHaveBeenCalled();
  });
  it("scopes platform reads to Viewed organization and resets decisions on scope changes", () => {
    prepare(); expect(h.query).toHaveBeenLastCalledWith(undefined, { organizationId: "org-A", enabled: true }); h.org = "org-B"; expect(dialog().props.open).toBe(false); expect(h.query).toHaveBeenLastCalledWith(undefined, { organizationId: "org-B", enabled: true });
  });
  it("exposes failed-read retry and blocks a cached decision until recovery", () => {
    prepare(); h.queue.isError = true; h.queue.error = new Error("Queue unavailable"); expect(buttons("Record decision")[0].props.disabled).toBe(true);
    nodes(render()).find(n => n.props.what === "employee request queue")!.props.onRetry(); expect(h.queue.refetch).toHaveBeenCalledOnce();
  });
  it.each([0, 2, 3])("waits for an authoritative refresh after kind %s loses its successful acknowledgement", async index => {
    const refresh = deferred(); h.decide.mockRejectedValue(new Error("Response lost"));
    h.queue.refetch.mockImplementation(() => refresh.promise.then(() => {
      if (index === 0) h.queue.data.timeOff.shift();
      else if (index === 2) h.queue.data.openShiftClaims = [];
      else h.queue.data.shiftSwaps = [];
      return { isError: false };
    }));
    prepare(index); const submit = buttons("Record decision")[0].props.onClick; submit(); await flush();
    expect(h.queue.refetch).toHaveBeenCalledExactlyOnceWith({ throwOnError: true });
    expect(field().props.disabled).toBe(true); expect(buttons("Cancel")[0].props.disabled).toBe(true); submit(); expect(h.decide).toHaveBeenCalledTimes(1); expect(h.toast).not.toHaveBeenCalled();
    refresh.resolve(); await flush();
    expect(field().props.disabled).toBe(false); expect(field().props.value).toBe("Reviewed current coverage");
    expect(buttons("Record decision")[0].props.disabled).toBe(true); expect(text(render())).toContain("This request is no longer in the pending queue");
    buttons("Record decision")[0].props.onClick(); expect(h.decide).toHaveBeenCalledTimes(1);
  });
  it("keeps a failed decision draft blocked after failed refresh until the read retry succeeds", async () => {
    const refresh = deferred(); h.decide.mockRejectedValue(new Error("Approval unavailable"));
    h.queue.refetch.mockImplementation(() => refresh.promise.then(() => { h.queue.isError = true; h.queue.error = new Error("Queue read unavailable"); throw h.queue.error; }));
    prepare(); buttons("Record decision")[0].props.onClick(); await flush(); expect(field().props.disabled).toBe(true);
    refresh.resolve(); await flush(); expect(field().props.disabled).toBe(false); expect(field().props.value).toBe("Reviewed current coverage"); expect(buttons("Record decision")[0].props.disabled).toBe(true);
    expect(h.toast.mock.calls.at(-1)![0].description).toContain("Refresh the queue successfully before retrying.");
    h.queue.refetch.mockImplementation(async () => { h.queue.isError = false; h.queue.error = null; return { isError: false }; });
    nodes(render()).find(n => n.props.what === "employee request queue")!.props.onRetry(); await flush();
    expect(buttons("Record decision")[0].props.disabled).toBe(false); expect(field().props.value).toBe("Reviewed current coverage"); expect(h.decide).toHaveBeenCalledOnce();
  });
  it("suppresses recovery feedback when the queue is abandoned during its refresh", async () => {
    const refresh = deferred(); h.decide.mockRejectedValue(new Error("Response lost")); h.queue.refetch.mockImplementation(() => refresh.promise.then(() => ({ isError: false })));
    prepare(); const submit = buttons("Record decision")[0].props.onClick; const cleanups = h.effects.map(effect => effect()).filter((value): value is () => void => typeof value === "function"); submit(); await flush();
    cleanups.forEach(cleanup => cleanup()); refresh.resolve(); await flush(); expect(h.toast).not.toHaveBeenCalled();
  });
});
