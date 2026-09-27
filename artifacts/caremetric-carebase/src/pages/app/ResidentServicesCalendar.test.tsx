import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], facility: "a", organization: "org", facilityError: false, role: "org_admin",
  referenceError: false, vehicleError: false, pending: false, calendar: vi.fn(), create: vi.fn(), outcome: vi.fn(), reschedule: vi.fn(), vehicle: vi.fn(), toast: vi.fn(), retry: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => { const slots = h.slots, i = h.cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (fn: () => void, deps: unknown[]) => { const i = h.cursor++, previous = h.slots[i] as unknown[] | undefined; if (!previous || deps.some((value, index) => !Object.is(value, previous[index]))) { h.slots[i] = deps; h.effects.push(fn); } },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: h.role, organizationId: h.organization } }), hasRole: (user: { role: string }, ...roles: string[]) => roles.includes(user.role) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidentNavigationContext", () => ({ useResidentNavigationContext: () => ({ facilityId: h.facility, residentId: "", setFacilityId: (id: string) => { h.facility = id; }, setResidentId: vi.fn(), adoptDefaultFacility: vi.fn() }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: ["a", "b"].map(id => ({ id, name: id, organization_id: "org" })), isError: h.facilityError, refetch: h.retry }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [{ id: `${h.facility}-resident`, first_name: "Pat", last_name: h.facility }], isError: h.referenceError, refetch: h.retry }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [], refetch: h.retry }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentServicesCalendar", () => ({
  useResidentServicesCalendar: (...args: unknown[]) => { h.calendar(...args); return { data: [{ id: `${h.facility}-event`, facility_id: h.facility, title: "Clinic", status: "scheduled", starts_at: "2026-09-28T13:00:00Z", ends_at: "2026-09-28T14:00:00Z" }], refetch: h.retry }; },
  useFacilityTransportVehicles: () => ({ data: [{ id: `${h.facility}-van`, facility_id: h.facility, label: "Facility van", vehicle_type: "van", license_plate: "VAN123", capacity: 6, wheelchair_accessible: true, status: "available", notes: "Existing vehicle notes" }], isError: h.vehicleError, refetch: h.retry }),
  useCreateResidentServiceCalendarEvent: () => ({ mutate: h.create, isPending: h.pending }),
  useRecordResidentServiceCalendarOutcome: () => ({ mutate: h.outcome, isPending: h.pending }),
  useRescheduleResidentServiceCalendarEvent: () => ({ mutate: h.reschedule, isPending: h.pending }),
  useSaveFacilityTransportVehicle: () => ({ mutate: h.vehicle, isPending: h.pending }),
}));
import ResidentServicesCalendar from "./ResidentServicesCalendar";
type Node = ReactElement<Record<string, any>>;
const nodes = (value: ReactNode): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
const text = (value: ReactNode): string => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : "";
let frames = new Map<string, unknown[]>(), workspaceKey: string | null | undefined;
const childKeys = new Map<string, string | null>();
function frame(component: (props: any) => ReactNode, props: unknown, key: string) {
  h.slots = frames.get(key) ?? []; frames.set(key, h.slots); h.cursor = 0;
  let result = component(props);
  if (h.effects.length) { h.effects.splice(0).forEach(fn => fn()); h.cursor = 0; result = component(props); }
  return result;
}
function page() {
  const root = ResidentServicesCalendar() as Node;
  if (workspaceKey !== root.key) { frames = new Map(); childKeys.clear(); workspaceKey = root.key; }
  return frame(root.type as (props: any) => ReactNode, root.props, "page");
}
function component(name: string) {
  const root = nodes(page()).find(node => typeof node.type === "function" && node.type.name === name)!;
  if (childKeys.get(name) !== root.key) { frames.delete(name); childKeys.set(name, root.key); }
  return frame(root.type as (props: any) => ReactNode, root.props, name);
}
function field(name: string, label: string) { return nodes(component(name)).find(node => node.props.label === label)!.props.children as Node; }
function fill(name: string, label: string, value: string) { const control = field(name, label); control.props.onChange(typeof control.type === "function" && control.type.name === "Choice" ? value : { target: { value } }); }
function button(name: string, label: string) { return nodes(component(name)).find(node => node.props.onClick && text(node.props.children) === label)!; }
function click(name: string, label: string) { const target = button(name, label); expect(target.props.disabled).toBeFalsy(); target.props.onClick(); }
function openCreate() { nodes(page()).find(node => node.props.onClick && text(node.props.children) === "Schedule service")!.props.onClick(); }
function openEvent(kind: "onOutcome" | "onReschedule") { const row = nodes(page()).find(node => node.props.event && node.props[kind])!; row.props[kind](row.props.event); }
function createDraft() { openCreate(); fill("CreateEventDialog", "Resident", `${h.facility}-resident`); fill("CreateEventDialog", "Title", "Clinic visit"); fill("CreateEventDialog", "Starts", "2026-09-28T09:00"); fill("CreateEventDialog", "Ends", "2026-09-28T10:00"); }
beforeEach(() => { vi.clearAllMocks(); frames = new Map(); childKeys.clear(); workspaceKey = undefined; h.slots = []; h.effects = []; h.facility = "a"; h.organization = "org"; h.facilityError = false; h.role = "org_admin"; h.pending = false; h.referenceError = false; h.vehicleError = false; });

describe("resident calendar draft and input boundaries", () => {
  it("cannot display an old facility's events after changing organization", () => {
    page(); h.organization = "replacement-org";
    const result = page(); expect(h.calendar).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: "replacement-org", facilityId: "a" }), { enabled: false });
    expect(nodes(result).some(node => typeof node.type === "function" && node.type.name === "EventRow")).toBe(false);
    expect(nodes(result).some(node => typeof node.type === "function" && node.type.name === "VehicleWorkspace")).toBe(false);
    expect(text(result)).toContain("Select a facility in the current organization");
  });
  it("hides cached calendar actions while facility authorization cannot be loaded", () => {
    openEvent("onOutcome"); h.facilityError = true;
    const result = page(); expect(h.calendar).toHaveBeenLastCalledWith(expect.any(Object), { enabled: false });
    expect(nodes(result).some(node => typeof node.type === "function" && node.type.name === "EventRow")).toBe(false);
    expect(nodes(component("OutcomeDialog"))[0].props.open).toBe(false);
  });
  it("updates a vehicle's status and capacity without creating a duplicate or discarding notes", () => {
    click("VehicleWorkspace", "Edit"); fill("VehicleWorkspace", "Status", "maintenance"); fill("VehicleWorkspace", "Capacity", "8");
    click("VehicleWorkspace", "Save vehicle"); click("VehicleWorkspace", "Save vehicle");
    expect(h.vehicle).toHaveBeenCalledOnce(); expect(h.vehicle.mock.calls[0][0]).toMatchObject({ facilityId: "a", vehicleId: "a-van", status: "maintenance", capacity: 8, notes: "Existing vehicle notes", wheelchairAccessible: true, licensePlate: "VAN123" });
    button("VehicleWorkspace", "Cancel edit").props.onClick(); expect(field("VehicleWorkspace", "Capacity").props.value).toBe("8");
    h.vehicle.mock.calls[0][1].onError(new Error("Temporary error")); h.vehicle.mock.calls[0][1].onSettled(); click("VehicleWorkspace", "Save vehicle");
    expect(h.vehicle.mock.calls[1][0]).toEqual(h.vehicle.mock.calls[0][0]); h.vehicle.mock.calls[1][1].onSuccess();
    expect(field("VehicleWorkspace", "Label").props.value).toBe(""); expect(button("VehicleWorkspace", "Cancel edit")).toBeUndefined();
  });
  it("cancels an edit without saving, preserves ordinary refreshed drafts and rejects failed fleet reads", () => {
    click("VehicleWorkspace", "Edit"); fill("VehicleWorkspace", "Notes", "Unsaved inspection detail"); component("VehicleWorkspace");
    expect(field("VehicleWorkspace", "Notes").props.value).toBe("Unsaved inspection detail");
    h.vehicleError = true; expect(button("VehicleWorkspace", "Save vehicle").props.disabled).toBe(true); button("VehicleWorkspace", "Save vehicle").props.onClick(); expect(h.vehicle).not.toHaveBeenCalled();
    h.vehicleError = false; click("VehicleWorkspace", "Cancel edit"); expect(field("VehicleWorkspace", "Notes").props.value).toBe("");
  });
  it("offers no fleet write controls to an auditor", () => { h.role = "auditor"; expect(button("VehicleWorkspace", "Edit")).toBeUndefined(); expect(button("VehicleWorkspace", "Save vehicle")).toBeUndefined(); });
  it("replaces facility vehicle and service drafts, including A-to-B-to-A navigation", () => {
    createDraft(); fill("VehicleWorkspace", "Label", "A van");
    h.facility = "b"; expect(field("VehicleWorkspace", "Label").props.value).toBe("");
    expect(field("CreateEventDialog", "Resident").props.value).toBe("");
    fill("VehicleWorkspace", "Label", "B van"); click("VehicleWorkspace", "Save vehicle");
    expect(h.vehicle).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "b", label: "B van", capacity: 6 }), expect.any(Object));
    h.facility = "a"; expect(field("VehicleWorkspace", "Label").props.value).toBe("");
  });
  it.each(["", "0", "1.5", "101", "Infinity"])("rejects invalid vehicle capacity %j in both the button and handler", value => {
    fill("VehicleWorkspace", "Label", "Van"); fill("VehicleWorkspace", "Capacity", value);
    expect(button("VehicleWorkspace", "Save vehicle").props.disabled).toBe(true); button("VehicleWorkspace", "Save vehicle").props.onClick(); expect(h.vehicle).not.toHaveBeenCalled();
  });
  it.each(["", "2026-02-30", "invalid", "2026-12-31"])("pauses the calendar on invalid or reversed From date %j", value => {
    nodes(page()).find(node => node.props["aria-label"] === "Through date")!.props.onChange({ target: { value: "2026-10-01" } });
    nodes(page()).find(node => node.props["aria-label"] === "From date")!.props.onChange({ target: { value } }); page();
    expect(h.calendar).toHaveBeenLastCalledWith(expect.any(Object), { enabled: false });
  });
  it("rejects nonexistent facility times before creating or rescheduling a service", () => {
    createDraft(); fill("CreateEventDialog", "Starts", "2026-03-08T02:30"); fill("CreateEventDialog", "Ends", "2026-03-08T04:00");
    expect(button("CreateEventDialog", "Schedule service").props.disabled).toBe(true); button("CreateEventDialog", "Schedule service").props.onClick(); expect(h.create).not.toHaveBeenCalled();
    openEvent("onReschedule"); fill("RescheduleDialog", "Reason", "Clinic changed time"); fill("RescheduleDialog", "Starts", "2026-03-08T02:30"); fill("RescheduleDialog", "Ends", "2026-03-08T04:00");
    button("RescheduleDialog", "Reschedule").props.onClick(); expect(h.reschedule).not.toHaveBeenCalled();
  });
  it("preserves a failed create draft, prevents duplicates, and submits the retry", () => {
    createDraft(); click("CreateEventDialog", "Schedule service"); click("CreateEventDialog", "Schedule service"); expect(h.create).toHaveBeenCalledOnce();
    expect(h.create.mock.calls[0][0]).toMatchObject({ residentId: "a-resident", event: { startsAt: "2026-09-28T13:00:00.000Z" } });
    const callbacks = h.create.mock.calls[0][1]; callbacks.onError(new Error("Network failed")); callbacks.onSettled();
    expect(field("CreateEventDialog", "Title").props.value).toBe("Clinic visit"); click("CreateEventDialog", "Schedule service"); expect(h.create).toHaveBeenCalledTimes(2);
  });
  it("does not schedule from stale resident choices after their read fails", () => { createDraft(); h.referenceError = true; expect(button("CreateEventDialog", "Schedule service").props.disabled).toBe(true); button("CreateEventDialog", "Schedule service").props.onClick(); expect(h.create).not.toHaveBeenCalled(); });
  it("locks each submitted form and prevents dialog dismissal until settlement", () => {
    createDraft(); click("CreateEventDialog", "Schedule service"); h.pending = true;
    expect(nodes(component("CreateEventDialog")).find(node => node.type === "fieldset")!.props.disabled).toBe(true);
    nodes(component("CreateEventDialog"))[0].props.onOpenChange(false);
    expect(nodes(component("CreateEventDialog"))[0].props.open).toBe(true);
  });
  it("refuses invalid follow-up/next times and resets an outcome draft for another event", () => {
    openEvent("onOutcome"); fill("OutcomeDialog", "Next appointment", "2026-03-08T02:30");
    expect(button("OutcomeDialog", "Record outcome").props.disabled).toBe(true); button("OutcomeDialog", "Record outcome").props.onClick(); expect(h.outcome).not.toHaveBeenCalled();
    const due = nodes(component("OutcomeDialog")).find(node => node.props["aria-label"] === "Follow-up due")!; due.props.onChange({ target: { value: "2026-03-08T02:30" } });
    expect(button("OutcomeDialog", "Add follow-up").props.disabled).toBe(true);
    h.facility = "b"; openEvent("onOutcome"); expect(field("OutcomeDialog", "Next appointment").props.value).toBe("");
  });
  it("preserves a newer facility draft after a delayed old creation completes", () => {
    createDraft(); click("CreateEventDialog", "Schedule service"); const finish = h.create.mock.calls[0][1].onSuccess;
    h.facility = "b"; createDraft(); fill("CreateEventDialog", "Title", "New B appointment"); finish();
    expect(field("CreateEventDialog", "Title").props.value).toBe("New B appointment"); expect(nodes(component("CreateEventDialog"))[0].props.open).toBe(true);
  });
});
