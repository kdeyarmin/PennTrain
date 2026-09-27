import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[], pending: false, role: "employee", service: vi.fn(), direct: vi.fn(), offline: vi.fn(), sync: vi.fn(), profile: vi.fn(), census: vi.fn(), toast: vi.fn(), close: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const slots = h.slots, i = h.cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const i = h.cursor++, old = h.slots[i] as unknown[] | undefined; if (!old || deps.some((value, j) => !Object.is(value, old[j]))) { h.slots[i] = deps; h.effects.push(fn); } },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "actor", role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFloorMode", () => ({ useRecordServiceTaskResponse: () => ({ mutateAsync: h.service, isPending: h.pending }), useRecordUnscheduledService: () => ({ mutateAsync: h.direct, isPending: h.pending }) }));
vi.mock("@/hooks/useOfflineServiceDrafts", () => ({ SYNC_OUTCOME_MESSAGES: {}, useSaveOfflineServiceDraft: () => ({ mutateAsync: h.offline, isPending: h.pending }), useSaveOfflineUnscheduledDraft: () => ({ mutateAsync: h.offline, isPending: h.pending }), useSyncOfflineServiceDraft: () => ({ mutateAsync: h.sync, isPending: h.pending }) }));
vi.mock("@/hooks/useResidentCareHeader", () => ({ useSaveResidentCareProfile: () => ({ mutate: h.profile, isPending: h.pending }) }));
vi.mock("@/hooks/useAdmissions", () => ({ useTransitionResidentCensus: () => ({ mutate: h.census, isPending: h.pending }) }));
import { DocumentCareDialog } from "./DocumentCareDialog";
import { UnscheduledServiceDialog } from "./UnscheduledServiceDialog";
import { EditResidentCareProfileDialog } from "./EditResidentCareProfileDialog";
import { ResidentCensusStatusDialog } from "./ResidentCensusStatusDialog";
import { ServiceExceptionFollowUpDialog } from "./ServiceExceptionFollowUpDialog";
type Node = ReactElement<Record<string, any>>;
const nodes = (value: ReactNode): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
const text = (value: ReactNode): string => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : "";
function render(component: () => ReactNode) { h.cursor = 0; let result = component(); if (h.effects.length) { h.effects.splice(0).forEach(fn => { const cleanup = fn(); if (cleanup) h.cleanups.push(cleanup); }); h.cursor = 0; result = component(); } return nodes(result); }
function unmount() { h.cleanups.splice(0).forEach(fn => fn()); h.slots = []; h.effects = []; }
const button = (list: Node[], label: string) => list.find(node => node.props.onClick && text(node.props.children) === label)!;
const task = { id: "task-a", serviceName: "Daily care", residentName: "Resident A", room: "1", residentId: "resident-a", organizationId: "org", facilityId: "facility", scheduledStart: "2026-09-27T13:00:00Z", scheduledEnd: "2026-09-27T14:00:00Z", acceptableResponses: ["completed_as_planned"] };
const scheduled = () => DocumentCareDialog({ open: true, onOpenChange: h.close, task });
const extra = () => UnscheduledServiceDialog({ open: true, onOpenChange: h.close, residentId: "resident-a", residentName: "Resident A", organizationId: "org", facilityId: "facility" });
function deferred() { let resolve!: (value?: any) => void, reject!: (reason: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.cleanups = []; h.pending = false; h.role = "employee"; h.offline.mockResolvedValue({ draftId: "draft" }); h.sync.mockResolvedValue("applied"); vi.stubGlobal("navigator", { onLine: true }); vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe("bedside submission lifetime", () => {
  it("creates only one durable extra-care draft for same-render repeated clicks", async () => {
    const pending = deferred(); h.offline.mockReturnValueOnce(pending.promise);
    button(render(extra), "Extra transfer help").props.onClick(); const record = button(render(extra), "Record"); record.props.onClick(); record.props.onClick();
    expect(h.offline).toHaveBeenCalledOnce(); expect(h.offline.mock.calls[0][0]).toMatchObject({ residentId: "resident-a", serviceKind: "extra_transfer_assistance" });
    render(extra)[0].props.onOpenChange(false); expect(h.close).not.toHaveBeenCalled();
    pending.resolve({ draftId: "draft" }); await flush(); expect(h.sync).toHaveBeenCalledExactlyOnceWith("draft"); expect(h.close).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("does not close a replacement dialog when an unmounted extra-care draft completes", async () => {
    const pending = deferred(); h.offline.mockReturnValueOnce(pending.promise); button(render(extra), "Extra transfer help").props.onClick(); button(render(extra), "Record").props.onClick();
    unmount(); render(extra); pending.resolve({ draftId: "draft-a" }); await flush(); expect(h.close).not.toHaveBeenCalled(); expect(h.sync).not.toHaveBeenCalled();
  });
  it("does not fall back to a direct write after leaving an old failed local save", async () => {
    const pending = deferred(); h.offline.mockReturnValueOnce(pending.promise); button(render(extra), "Extra transfer help").props.onClick(); button(render(extra), "Record").props.onClick();
    unmount(); pending.reject(new Error("Local storage failed")); await flush(); expect(h.direct).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("retains offline care and reports local persistence before closing", async () => {
    vi.stubGlobal("navigator", { onLine: false }); button(render(extra), "Extra transfer help").props.onClick(); button(render(extra), "Record").props.onClick(); await flush();
    expect(h.offline).toHaveBeenCalledOnce(); expect(h.sync).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved on this device" })); expect(h.close).toHaveBeenCalledWith(false);
  });
  it("prevents duplicate scheduled-care writes and ignores completion after unmount", async () => {
    const pending = deferred(); h.service.mockReturnValueOnce(pending.promise); const action = button(render(scheduled), "Completed as planned"); action.props.onClick(); action.props.onClick();
    expect(h.service).toHaveBeenCalledOnce(); render(scheduled)[0].props.onOpenChange(false); expect(h.close).not.toHaveBeenCalled();
    unmount(); render(scheduled); pending.resolve(); await flush(); expect(h.close).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled();
  });
  it("keeps a failed scheduled response retryable", async () => {
    h.service.mockRejectedValueOnce(new Error("Permission or service failure")); button(render(scheduled), "Completed as planned").props.onClick(); await flush(); expect(h.close).not.toHaveBeenCalled();
    h.service.mockResolvedValueOnce(undefined); button(render(scheduled), "Completed as planned").props.onClick(); await flush(); expect(h.service).toHaveBeenCalledTimes(2); expect(h.close).toHaveBeenCalledWith(false);
  });
  it("freezes pending bedside inputs", () => {
    button(render(extra), "Extra transfer help").props.onClick(); h.pending = true;
    expect(render(extra).find(node => node.props.id === "unscheduled-note")!.props.disabled).toBe(true); expect(button(render(extra), "Cancel").props.disabled).toBe(true);
    unmount(); expect(render(scheduled).find(node => node.type === "fieldset")!.props.disabled).toBe(true);
  });
});

describe("resident and supervisor submitted drafts", () => {
  it("keeps a failed supervisor reason for retry and waits before allowing dismissal", async () => {
    const pending = deferred(), confirm = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(true);
    const page = () => ServiceExceptionFollowUpDialog({ open: true, pending: false, taskName: "Bath", residentName: "Pat", existingNote: null, onOpenChange: h.close, onConfirm: confirm });
    render(page).find(node => node.props.id === "service-exception-reason")!.props.onChange({ target: { value: "Repeated refusals" } });
    const action = button(render(page), "Raise follow-up"); action.props.onClick(); action.props.onClick(); render(page)[0].props.onOpenChange(false); expect(h.close).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledOnce();
    pending.resolve(false); await flush(); expect(render(page).find(node => node.props.id === "service-exception-reason")!.props.value).toBe("Repeated refusals");
    button(render(page), "Raise follow-up").props.onClick(); await flush(); expect(confirm).toHaveBeenLastCalledWith("Repeated refusals"); expect(render(page).find(node => node.props.id === "service-exception-reason")!.props.value).toBe("");
  });
  it("does not apply a stale census choice after another actor changed the current status", () => {
    let status = "active";
    const page = () => ResidentCensusStatusDialog({ open: true, onOpenChange: h.close, residentId: "resident", residentName: "Pat", currentStatus: status });
    render(page).find(node => node.props.onValueChange)!.props.onValueChange("hospital_leave"); render(page).find(node => node.props.id === "census-reason")!.props.onChange({ target: { value: "Going to hospital" } });
    status = "discharged"; const action = button(render(page), "Record status change"); expect(action.props.disabled).toBe(true); action.props.onClick(); expect(h.census).not.toHaveBeenCalled();
  });
  it("serializes census writes and retains the reason after failure", () => {
    const page = () => ResidentCensusStatusDialog({ open: true, onOpenChange: h.close, residentId: "resident", residentName: "Pat", currentStatus: "active" });
    render(page).find(node => node.props.onValueChange)!.props.onValueChange("hospital_leave"); render(page).find(node => node.props.id === "census-reason")!.props.onChange({ target: { value: "Hospital evaluation" } });
    const action = button(render(page), "Record status change"); action.props.onClick(); action.props.onClick(); render(page)[0].props.onOpenChange(false); expect(h.census).toHaveBeenCalledOnce(); expect(h.close).not.toHaveBeenCalled();
    h.census.mock.calls[0][1].onError(new Error("Bed state changed")); h.census.mock.calls[0][1].onSettled(); button(render(page), "Record status change").props.onClick(); expect(h.census).toHaveBeenCalledTimes(2); expect(h.census.mock.calls[1][0].reason).toBe("Hospital evaluation");
  });
  it("serializes care header reviews and preserves failed edits", () => {
    const current = { care: { allergies: [], mobilityNeeds: null, mobilitySummary: null, supervisionRequirements: null } } as unknown as Parameters<typeof EditResidentCareProfileDialog>[0]["current"];
    const page = () => EditResidentCareProfileDialog({ open: true, onOpenChange: h.close, residentId: "resident", current });
    render(page).find(node => node.props.id === "care-allergies")!.props.onChange({ target: { value: "Latex" } });
    const action = button(render(page), "Save care header"); action.props.onClick(); action.props.onClick(); render(page)[0].props.onOpenChange(false); expect(h.profile).toHaveBeenCalledOnce(); expect(h.close).not.toHaveBeenCalled();
    h.profile.mock.calls[0][1].onError(new Error("Temporary failure")); h.profile.mock.calls[0][1].onSettled(); expect(render(page).find(node => node.props.id === "care-allergies")!.props.value).toBe("Latex");
    button(render(page), "Save care header").props.onClick(); expect(h.profile).toHaveBeenCalledTimes(2); expect(h.profile.mock.calls[1][0].profile.allergies).toEqual(["Latex"]);
  });
});
