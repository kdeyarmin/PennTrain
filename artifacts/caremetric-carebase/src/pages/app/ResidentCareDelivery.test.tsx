import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], pageState: [] as unknown[], formState: [] as unknown[], cursor: 0, key: undefined as string | null | undefined,
  facilityId: "facility-a", residentId: "resident-a", residentsError: false, appointmentPending: false, transferPending: false,
  residents: [
    { id: "resident-a", first_name: "Resident", last_name: "A", facility_id: "facility-a", status: "active" },
    { id: "resident-b", first_name: "Resident", last_name: "B", facility_id: "facility-a", status: "active" },
    { id: "resident-c", first_name: "Resident", last_name: "C", facility_id: "facility-b", status: "active" },
  ],
  dme: vi.fn(), appointment: vi.fn(), transfer: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const state = h.state; const index = h.cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility-a", name: "A" }, { id: "facility-b", name: "B" }] }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: ({ facilityId }: { facilityId: string }) => ({ data: h.residents.filter(resident => resident.facility_id === facilityId), isError: h.residentsError }) }));
vi.mock("@/hooks/useResidentNavigationContext", () => ({ useResidentNavigationContext: () => ({
  facilityId: h.facilityId, residentId: h.residentId,
  setFacilityId: (id: string) => { h.facilityId = id; h.residentId = ""; }, setResidentId: (id: string) => { h.residentId = id; },
}) }));
vi.mock("@/hooks/useResidentCareDelivery", () => ({
  useResidentCareAnalytics: () => ({ data: undefined }),
  useRegisterResidentDmeItem: () => ({ mutate: h.dme }),
  useScheduleResidentAppointment: () => ({ mutate: h.appointment, isPending: h.appointmentPending }),
  useStartHospitalTransfer: () => ({ mutate: h.transfer, isPending: h.transferPending }),
}));
vi.mock("@/components/residents/DmeRegisterCard", () => ({ DmeRegisterCard: "section" }));
import ResidentCareDelivery from "./ResidentCareDelivery";
import { ResidentCareActionForms } from "@/components/residents/ResidentCareActionForms";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function content(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(content).join("");
  return value && typeof value === "object" && "props" in value ? content((value as Node).props.children as ReactNode) : "";
}
function render() {
  h.state = h.pageState; h.cursor = 0;
  const page = ResidentCareDelivery();
  const form = nodes(page).find(node => node.type === ResidentCareActionForms)!;
  if (h.key !== form.key) { h.formState = []; h.key = form.key; }
  h.state = h.formState; h.cursor = 0;
  return { page, form: ResidentCareActionForms(form.props as unknown as Parameters<typeof ResidentCareActionForms>[0]) };
}
function field(id: string) { return nodes(render().form).find(node => node.props.id === id)!; }
function fill(id: string, value: string) { (field(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function button(label: string) { return nodes(render().form).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode) === label)!; }
function click(label: string) { const target = button(label); expect(target.props.disabled).toBeFalsy(); (target.props.onClick as () => void)(); }
function draft() {
  fill("appointment-location", "Clinic A"); fill("appointment-date", "2026-09-27T09:30");
  fill("transfer-destination", "Hospital A"); fill("transfer-reason", "Resident A observed concern");
}
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.pageState = []; h.formState = []; h.cursor = 0; h.key = undefined;
  h.facilityId = "facility-a"; h.residentId = "resident-a"; h.residentsError = false;
  h.appointmentPending = false; h.transferPending = false;
});
describe("resident care action identity", () => {
  it("freezes only the submitted form while its save is pending", () => {
    draft(); click("Schedule appointment"); h.appointmentPending = true;
    expect(field("appointment-location").props.disabled).toBe(true);
    expect(field("appointment-date").props.disabled).toBe(true);
    expect(field("transfer-reason").props.disabled).toBe(false);
    click("Start transfer"); h.transferPending = true;
    expect(field("transfer-destination").props.disabled).toBe(true);
    expect(field("transfer-reason").props.disabled).toBe(true);
    const picker = nodes(render().form).find(node => node.props.onValueChange && node.props.value === "resident-a")!;
    expect(picker.props.disabled).toBe(false);
  });
  it("clears clinical drafts on resident selection while preserving reporting dates", () => {
    draft();
    const from = nodes(render().page).find(node => node.props.id === "from")!;
    (from.props.onChange as (event: unknown) => void)({ target: { value: "2026-08-01" } });
    const picker = nodes(render().form).find(node => node.props.onValueChange && node.props.value === "resident-a")!;
    (picker.props.onValueChange as (id: string) => void)("resident-b");
    for (const id of ["appointment-location", "appointment-date", "transfer-destination", "transfer-reason"]) expect(field(id).props.value).toBe("");
    expect(button("Start transfer").props.disabled).toBe(true);
    expect(nodes(render().page).find(node => node.props.id === "from")!.props.value).toBe("2026-08-01");
  });
  it("clears facility drafts and refuses a mismatched URL resident", () => {
    draft(); h.facilityId = "facility-b";
    expect(field("transfer-reason").props.value).toBe("");
    draft();
    for (const label of ["Register DME", "Schedule appointment", "Start transfer"]) {
      const target = button(label); expect(target.props.disabled).toBe(true); (target.props.onClick as () => void)();
    }
    expect(h.dme).not.toHaveBeenCalled(); expect(h.appointment).not.toHaveBeenCalled(); expect(h.transfer).not.toHaveBeenCalled();
  });
  it("does not use stale resident data after a roster failure", () => {
    draft(); h.residentsError = true;
    expect(button("Start transfer").props.disabled).toBe(true);
    (button("Start transfer").props.onClick as () => void)();
    expect(h.transfer).not.toHaveBeenCalled();
  });
  it("preserves the replacement resident's draft when an earlier appointment completes", () => {
    draft(); click("Schedule appointment");
    expect(h.appointment.mock.calls[0][0]).toMatchObject({ residentId: "resident-a", startsAt: "2026-09-27T13:30:00.000Z" });
    const finish = h.appointment.mock.calls[0][1].onSuccess;
    h.residentId = "resident-b"; fill("appointment-location", "Clinic B");
    finish();
    expect(field("appointment-location").props.value).toBe("Clinic B");
  });
  it.each(["", "2026-02-30T09:30", "2026-03-08T02:30", "invalid"])("blocks invalid appointment date %j in the form and submit handler", value => {
    draft(); fill("appointment-date", value);
    expect(button("Schedule appointment").props.disabled).toBe(true);
    (button("Schedule appointment").props.onClick as () => void)();
    expect(h.appointment).not.toHaveBeenCalled();
  });
  it("trims transfer evidence and clears only the successfully saved draft", () => {
    draft(); fill("transfer-destination", "  Hospital A  "); click("Start transfer");
    expect(h.transfer.mock.calls[0][0]).toMatchObject({ residentId: "resident-a", destination: "Hospital A", reason: "Resident A observed concern" });
    h.transfer.mock.calls[0][1].onSuccess();
    expect(field("transfer-reason").props.value).toBe("");
    expect(field("appointment-location").props.value).toBe("Clinic A");
  });
});
