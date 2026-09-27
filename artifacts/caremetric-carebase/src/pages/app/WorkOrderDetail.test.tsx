import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], role: "org_admin", order: { id: "order", facility_id: "facility", organization_id: "org", status: "in_progress", safety_risk: "low", priority: "routine", location_detail: "Saved location" }, pending: false, update: vi.fn(), transition: vi.fn(), verify: vi.fn(), upload: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "work", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const old = h.slots[i] as unknown[] | undefined; if (!old || deps.some((dep, j) => !Object.is(dep, old[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "order" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useInspectionItems", () => ({ useGetInspectionItem: () => ({}) }));
vi.mock("@/components/employees/EmployeeSearchSelect", () => ({ EmployeeSearchSelect: "employee-select" }));
vi.mock("@/hooks/useWorkOrders", () => ({ useGetWorkOrder: () => ({ data: h.order }), useListMaintenanceDocuments: () => ({ data: [] }), useListWorkOrderHistory: () => ({ data: [] }), useUpdateWorkOrderDetails: () => ({ mutate: h.update, isPending: h.pending }), useTransitionWorkOrder: () => ({ mutate: h.transition, isPending: h.pending }), useVerifyWorkOrder: () => ({ mutate: h.verify, isPending: h.pending }), useUploadMaintenanceDocument: () => ({ mutate: h.upload, isPending: h.pending }), useMaintenanceDocumentSignedUrl: () => ({}), useDeleteMaintenanceDocument: () => ({}) }));
import WorkOrderDetail from "./WorkOrderDetail";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; let page = WorkOrderDetail(); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; page = WorkOrderDetail(); } return nodes(page); }
function field(id: string) { return render().find(node => node.props.id === `work-${id}`)!; }
function fill(id: string, value: string) { (field(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function button(label: string) { return render().find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === label)!; }
function click(label: string) { (button(label).props.onClick as () => void)(); }
function dialog(index: number) { return render().filter(node => node.type === Dialog)[index]; }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.pending = false; h.role = "org_admin"; h.order = { ...h.order, status: "in_progress" }; });
describe("maintenance record forms", () => {
  it("preserves an open edit when documentation invalidation refetches the same work order", () => {
    click("Edit details"); fill("location-detail", "Draft repair location"); h.order = { ...h.order }; expect(field("location-detail").props.value).toBe("Draft repair location");
  });
  it.each(["2026-02-30T10:00", "2026-03-08T02:30", "invalid"])("rejects invalid target time %s without throwing", value => {
    click("Edit details"); fill("target-completion", value); expect(button("Save changes").props.disabled).toBe(true); expect(() => click("Save changes")).not.toThrow(); expect(h.update).not.toHaveBeenCalled();
  });
  it.each(["-1", "Infinity", "not a cost", "0.001", "10000000000"])("rejects invalid estimated cost %s", value => { click("Edit details"); fill("estimated-cost", value); click("Save changes"); expect(h.update).not.toHaveBeenCalled(); });
  it("preserves a failed repair draft for retry and allows the next settled save", () => {
    click("Complete repair"); fill("field", "Pump replaced and tested"); click("Submit for verification");
    const options = h.transition.mock.calls[0][1]; options.onError(new Error("Network failed")); options.onSettled();
    expect(dialog(0).props.open).toBe(true); expect(field("field").props.value).toBe("Pump replaced and tested"); click("Submit for verification"); expect(h.transition).toHaveBeenCalledTimes(2);
  });
  it("freezes a pending repair, prevents duplicate submission and ignores dismissal", () => {
    click("Complete repair"); fill("field", "Pump replaced and tested"); const submit = button("Submit for verification").props.onClick as () => void; submit(); submit(); expect(h.transition).toHaveBeenCalledOnce();
    (dialog(0).props.onOpenChange as (open: boolean) => void)(false); expect(dialog(0).props.open).toBe(true); h.pending = true; expect(nodes(dialog(0)).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true);
  });
  it("rejects reversed downtime before submitting repair evidence", () => { click("Complete repair"); fill("field", "Pump repaired"); fill("downtime-started", "2026-09-26T12:00"); fill("downtime-ended", "2026-09-26T11:00"); click("Submit for verification"); expect(h.transition).not.toHaveBeenCalled(); });
  it("freezes supervisor findings and refuses duplicate verification", () => { h.order = { ...h.order, status: "pending_verification" }; click("Supervisor verification"); fill("verification-findings", "Repair tested and safe"); click("Verify repair"); click("Verify repair"); expect(h.verify).toHaveBeenCalledOnce(); (dialog(1).props.onOpenChange as (open: boolean) => void)(false); expect(dialog(1).props.open).toBe(true); });
  it("freezes a submitted edit without replacing it from a second opener", () => { click("Edit details"); fill("external-vendor", "Repair vendor"); click("Save changes"); click("Edit details"); (dialog(2).props.onOpenChange as (open: boolean) => void)(false); expect(dialog(2).props.open).toBe(true); expect(field("external-vendor").props.value).toBe("Repair vendor"); h.pending = true; expect(nodes(dialog(2)).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true); });
  it("keeps auditors without management controls", () => { h.role = "auditor"; expect(button("Edit details")).toBeUndefined(); expect(button("Complete repair")).toBeUndefined(); });
});
