import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], residentError: false, bedsError: false, pending: false,
  rows: [{ id: "resident-a", facility_id: "facility-a", status: "active" }, { id: "resident-b", facility_id: "facility-b", status: "active" }],
  transition: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const previous = h.slots[i] as unknown[] | undefined; if (!previous || deps.some((dep, j) => !Object.is(dep, previous[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility-a" }, { id: "facility-b" }] }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: ({ facilityId }: { facilityId?: string }) => ({ data: h.rows.filter(row => !facilityId || row.facility_id === facilityId), isError: h.residentError }) }));
vi.mock("@/components/residents/ResidentCensusStatusDialog", () => ({ CENSUS_TRANSITIONS: { active: ["temporarily_out", "hospital_leave", "discharged", "deceased"], hospital_leave: ["active", "discharged", "deceased"] } }));
vi.mock("@/hooks/useAdmissions", () => {
  const hooks: Record<string, () => unknown> = {};
  for (const name of ["CreateAdmissionProspect", "CreateReferralSource", "CreateRoomWithBeds", "RecordAdmissionActivity", "ReserveBedForProspect", "SetBedAvailability", "StartMoveInWorkspace", "AdvanceAdmissionPipelineStage", "UpdateAdmissionProspect"]) hooks[`use${name}`] = () => ({ mutate: vi.fn() });
  for (const name of ["ListAdmissionProspects", "ListCensusEvents", "ListMoveInWorkspaces", "ListReferralSources", "ListAdmissionActivities"]) hooks[`use${name}`] = () => ({ data: [] });
  hooks.useListFacilityBeds = () => ({ data: [], isError: h.bedsError });
  hooks.useTransitionResidentCensus = () => ({ mutate: h.transition, isPending: h.pending });
  return hooks;
});
import AdmissionOperations from "./AdmissionOperations";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; let page = AdmissionOperations(); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; page = AdmissionOperations(); } return page; }
function select(label: string, value?: string) { const target = nodes(render()).find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props["aria-label"] === label))!; if (value !== undefined) (target.props.onValueChange as (value: string) => void)(value); return target; }
function reason(value?: string) { const target = nodes(render()).find(node => node.props.placeholder === "Reason for census change")!; if (value !== undefined) (target.props.onChange as (event: unknown) => void)({ target: { value } }); return target; }
function submit() { return nodes(render()).find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === "Record census change")!; }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.cursor = 0; h.residentError = false; h.bedsError = false; h.pending = false; });
describe("admission census action scope", () => {
  function prepare() { select("Facility", "facility-a"); select("Census resident", "resident-a"); reason("Planned family visit"); }
  it("clears the selected census resident and reason when the facility changes", () => {
    prepare(); select("Facility", "facility-b");
    expect(select("Census resident").props.value).toBe(""); expect(reason().props.value).toBe(""); expect(submit().props.disabled).toBe(true);
    (submit().props.onClick as () => void)(); expect(h.transition).not.toHaveBeenCalled();
  });
  it.each(["resident", "beds"])("refuses census writes after the %s scope query fails with stale rows", kind => {
    prepare(); if (kind === "resident") h.residentError = true; else h.bedsError = true;
    expect(submit().props.disabled).toBe(true); (submit().props.onClick as () => void)(); expect(h.transition).not.toHaveBeenCalled();
  });
  it("does not erase a replacement resident's reason when an earlier census request succeeds", () => {
    prepare(); (submit().props.onClick as () => void)();
    expect(h.transition.mock.calls[0][0]).toMatchObject({ residentId: "resident-a", targetStatus: "temporarily_out" });
    const finish = h.transition.mock.calls[0][1].onSuccess;
    select("Facility", "facility-b"); select("Census resident", "resident-b"); reason("Resident B visit"); finish();
    expect(reason().props.value).toBe("Resident B visit");
  });
  it("requires a new reason after selecting a different resident", () => {
    select("Census resident", "resident-a"); reason("Resident A visit"); select("Census resident", "resident-b"); expect(reason().props.value).toBe("");
  });
});
