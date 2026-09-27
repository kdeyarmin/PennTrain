import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[], effectCursor: 0, queued: [] as (() => void)[],
  search: "", saveOrder: vi.fn(), saveLocation: vi.fn(), saveSchedule: vi.fn(), toast: vi.fn(), navigate: vi.fn(),
  pending: false, lookupError: false, retry: vi.fn(), assets: [] as Record<string, unknown>[], locations: [] as Record<string, unknown>[],
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "test", useMemo: (compute: () => unknown) => compute(),
  useRef: (initial: unknown) => { const index = h.refCursor++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
  useEffect: (effect: () => (() => void) | void, deps: unknown[] = []) => { const index = h.effectCursor++; const old = h.effects[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) h.queued.push(() => { old?.cleanup?.(); h.effects[index] = { deps, cleanup: effect() || undefined }; }); },
}));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/app/maintenance", h.navigate], useSearch: () => h.search }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/components/documents/DocumentDeletionQueue", () => ({ DocumentDeletionQueue: () => null }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "a", organization_id: "org", name: "A" }, { id: "b", organization_id: "org", name: "B" }], isError: h.lookupError, error: new Error("Facilities offline"), refetch: h.retry }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useInspectionItems", () => ({ useListInspectionItems: () => ({ data: h.assets, refetch: h.retry }) }));
vi.mock("@/components/employees/EmployeeSearchSelect", () => ({ EmployeeSearchSelect: "employee-select" }));
vi.mock("@/components/maintenance/MaintenanceQrCode", () => ({ MaintenanceQrCode: "qr" }));
vi.mock("@/hooks/useWorkOrders", () => ({
  useCreateWorkOrder: () => ({ mutate: h.saveOrder, isPending: h.pending }), useCreateMaintenanceLocation: () => ({ mutate: h.saveLocation, isPending: h.pending }),
  useCreatePreventiveMaintenanceSchedule: () => ({ mutate: h.saveSchedule, isPending: h.pending }),
  useGenerateDuePreventiveMaintenance: () => ({ mutate: vi.fn() }), useUpdatePreventiveMaintenanceSchedule: () => ({ mutate: vi.fn() }),
  useListMaintenanceLocations: () => ({ data: h.locations, refetch: h.retry }), useListPreventiveMaintenanceSchedules: () => ({ data: [] }), useListWorkOrders: () => ({ data: [] }),
}));
import Maintenance from "./Maintenance";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; const tree = Maintenance(); const effects = h.queued.splice(0); effects.forEach(run => run()); return tree; }
function click(label: string) { const node = nodes(render()).find(node => node.props.onClick && text(node).trim() === label); if (!node) throw Error(`Missing ${label}`); (node.props.onClick as () => void)(); }
function draft(kind: "order" | "schedule" | "location") { render(); if (kind === "order") { h.state[3] = true; h.state[6] = { ...(h.state[6] as object), facilityId: "a", description: "Repair door" }; }
  else if (kind === "schedule") { h.state[4] = true; h.state[7] = { ...(h.state[7] as object), facilityId: "a", assetId: "asset", title: "Check door", description: "Check the latch", nextDueDate: "2026-10-01" }; }
  else { h.state[5] = true; h.state[8] = { ...(h.state[8] as object), facilityId: "a", label: "Main entrance" }; } }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.effects = []; h.queued = []; h.pending = false; h.lookupError = false; h.search = "";
  h.assets = [{ id: "asset", facility_id: "a", label: "Door" }, { id: "asset-b", facility_id: "b", label: "Second door" }]; h.locations = [];
  vi.stubGlobal("window", { location: { get search() { return h.search; } } }); });
describe("maintenance create and QR recovery", () => {
  it("consumes a QR prefill once so background reference refresh cannot reopen a canceled form", () => {
    h.search = "?action=add&assetId=asset"; render(); expect(h.state[3]).toBe(true); h.state[3] = false;
    h.assets = [...h.assets]; render(); expect(h.state[3]).toBe(false);
  });
  it("does not copy another QR target's dirty description into the new target", () => {
    h.search = "?action=add&assetId=asset"; render(); h.state[6] = { ...(h.state[6] as object), description: "Private first repair" };
    h.search = "?action=add&assetId=asset-b"; h.assets = [...h.assets]; render();
    expect(h.state[6]).toMatchObject({ facilityId: "b", assetId: "asset-b", description: "" });
  });
  it.each(["2026-02-30T12:00", "2027-03-14T02:30", "not-a-date"])("rejects invalid/nonexistent target %s without throwing", target => {
    draft("order"); h.state[6] = { ...(h.state[6] as object), target };
    expect(() => click("Create work order")).not.toThrow(); expect(h.saveOrder).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalled();
  });
  it.each(["-1", "Infinity", "0.001"])("rejects invalid estimated cost %s", estimatedCost => {
    draft("order"); h.state[6] = { ...(h.state[6] as object), estimatedCost }; click("Create work order"); expect(h.saveOrder).not.toHaveBeenCalled();
  });
  it.each([["frequencyInterval", ""], ["frequencyInterval", "0"], ["frequencyInterval", "1.5"], ["frequencyInterval", "366"], ["durationMinutes", "2.5"], ["nextDueDate", "2026-02-30"]])("rejects invalid schedule %s = %s", (key, value) => {
    draft("schedule"); h.state[7] = { ...(h.state[7] as object), [key]: value }; click("Save schedule"); expect(h.saveSchedule).not.toHaveBeenCalled();
  });
  it("saves explicit zero costs and durations without changing them into missing values", () => {
    draft("schedule"); h.state[7] = { ...(h.state[7] as object), estimatedCost: "0", durationMinutes: "0", frequencyInterval: "1" };
    click("Save schedule"); expect(h.saveSchedule).toHaveBeenCalledWith(expect.objectContaining({ estimated_cost: 0, estimated_duration_minutes: 0, frequency_interval: 1 }), expect.anything());
  });
  it("keeps pending dialogs and snapshots locked until the save settles", () => {
    draft("order"); h.pending = true; const tree = render(); const dialog = nodes(tree).find(node => node.props.open === true && node.props.onOpenChange)!;
    (dialog.props.onOpenChange as (open: boolean) => void)(false); expect(h.state[3]).toBe(true);
    expect(nodes(tree).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true);
    click("New work order"); expect(h.state[6]).toMatchObject({ description: "Repair door" });
  });
  it("expires successful create navigation and feedback after page teardown", () => {
    draft("order"); click("Create work order"); h.effects.forEach(effect => effect.cleanup?.());
    h.saveOrder.mock.calls[0][1].onSuccess("created"); expect(h.navigate).not.toHaveBeenCalled();
  });
  it("blocks creation while facility scope is unconfirmed and exposes retry", () => {
    draft("order"); h.lookupError = true; click("Create work order"); expect(h.saveOrder).not.toHaveBeenCalled();
    const retry = nodes(render()).find(node => node.props.what === "maintenance form options")!;
    expect(retry).toBeDefined(); (retry.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalled();
  });
  it.each([
    ["order", "Create work order", "saveOrder", "success"], ["order", "Create work order", "saveOrder", "failure"],
    ["location", "Create QR location", "saveLocation", "success"], ["location", "Create QR location", "saveLocation", "failure"],
    ["schedule", "Save schedule", "saveSchedule", "success"], ["schedule", "Save schedule", "saveSchedule", "failure"],
  ] as const)("serializes same-render %s submissions and releases after %s/%s/%s", (kind, label, mutation, outcome) => {
    draft(kind); const submit = nodes(render()).find(node => node.props.onClick && text(node).trim() === label)!.props.onClick as () => void;
    submit(); submit(); expect(h[mutation]).toHaveBeenCalledOnce();
    const [input, options] = h[mutation].mock.calls[0]; expect(input).not.toHaveProperty("onSettled");
    if (outcome === "success") options.onSuccess("created"); else options.onError(new Error("Try again")); options.onSettled();
    draft(kind); click(label); expect(h[mutation]).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["order", "Create work order", "saveOrder", 6], ["location", "Create QR location", "saveLocation", 8], ["schedule", "Save schedule", "saveSchedule", 7],
  ] as const)("does not revive an old %s completion after QR A-to-B-to-A navigation", (kind, label, mutation, draftIndex) => {
    h.search = "?action=add&assetId=asset"; render(); draft(kind); click(label); const options = h[mutation].mock.calls[0][1]; const snapshot = h.state[draftIndex];
    h.pending = true; h.search = "?action=add&assetId=asset-b"; render(); h.search = "?action=add&assetId=asset"; render();
    options.onSuccess("old-created"); options.onError(new Error("Old error")); options.onSettled();
    expect(h.navigate).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled(); expect(h.state[draftIndex]).toEqual(snapshot);
  });
  it("keeps a same-scope success valid across ordinary reference refreshes", () => {
    draft("order"); click("Create work order"); const options = h.saveOrder.mock.calls[0][1]; h.assets = [...h.assets]; render(); options.onSuccess("created"); options.onSettled(); expect(h.navigate).toHaveBeenCalledWith("/app/maintenance/created");
  });
});
