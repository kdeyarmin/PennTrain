import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], pageSlots: [] as unknown[], childSlots: new Map<string, unknown[]>(), workspaceKey: undefined as string | null | undefined,
  facility: "facility-a", resident: "resident-a", role: "org_admin",
  profile: null as Record<string, unknown> | null, residentError: false,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>, pending: false,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => { const slots = h.slots; const i = h.cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const previous = h.slots[i] as unknown[] | undefined; if (!previous || deps.some((dep, j) => !Object.is(dep, previous[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role, organizationId: "org" } }), hasRole: (user: { role: string }, ...roles: string[]) => roles.includes(user.role) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility-a" }, { id: "facility-b" }] }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [{ id: `resident-${h.facility.slice(-1)}`, facility_id: h.facility, status: "active" }], isError: h.residentError }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [{ id: `employee-${h.facility.slice(-1)}` }] }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentNavigationContext", () => ({ useResidentNavigationContext: () => ({ facilityId: h.facility, residentId: h.resident, setFacilityId: vi.fn(), setResidentId: vi.fn(), adoptDefaultFacility: vi.fn() }) }));
vi.mock("@/hooks/useDietaryOperations", () => {
  const hooks: Record<string, () => unknown> = { useDietaryOperations: () => ({ data: { profile: h.profile, controls: [{ id: `control-${h.facility.slice(-1)}`, active: true }] } }) };
  for (const name of ["AssignWeightMonitoring", "CreateMenuCycle", "RecordFoodSafetyLog", "RecordHydration", "RecordMeal", "RecordNutritionReview", "RecordWeight", "SaveDietaryProfile", "SaveFoodSafetyControl", "SaveFoodServiceQualification", "VerifyFoodSafetyLog"]) hooks[`use${name}`] = () => ({ mutate: h.mutations[name] ??= vi.fn(), isPending: h.pending });
  return hooks;
});
import DietaryOperations from "./DietaryOperations";
import { Tabs } from "@/components/ui/tabs";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function renderWith(slots: unknown[], component: () => ReactNode): ReactNode { h.slots = slots; h.cursor = 0; let result = component(); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; result = component(); } return result; }
function child(name: string) {
  const page = renderWith(h.pageSlots, DietaryOperations);
  const tabs = nodes(page).find(node => node.type === Tabs)!;
  if (tabs.key !== h.workspaceKey) { h.childSlots.clear(); h.workspaceKey = tabs.key; }
  const node = nodes(page).find(node => typeof node.type === "function" && node.type.name === name)!;
  const key = `${name}:${node.key}`; const slots = h.childSlots.get(key) ?? []; h.childSlots.set(key, slots);
  return renderWith(slots, () => (node.type as (props: Record<string, unknown>) => ReactNode)(node.props));
}
function field(name: string, label: string) { const wrapper = nodes(child(name)).find(node => node.props.label === label)!; return nodes(wrapper.props.children as ReactNode).find(node => "value" in node.props)!; }
function fill(name: string, label: string, value: string) { const target = field(name, label); if (target.props.onChange) (target.props.onChange as (e: unknown) => void)({ target: { value } }); else (target.props.set as (value: string) => void)(value); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.pageSlots = []; h.effects = []; h.childSlots.clear(); h.workspaceKey = undefined; h.facility = "facility-a"; h.resident = "resident-a"; h.profile = null; h.residentError = false; h.role = "org_admin"; h.mutations = {}; h.pending = false; });

describe("dietary draft boundaries", () => {
  it.each([
    ["MenuOperations", "Cycle name", "A menu"],
    ["FoodSafetyOperations", "Control", "control-a"],
    ["QualificationOperations", "Employee", "employee-a"],
  ])("clears %s targets when switching between already-cached facilities", (name, label, value) => {
    fill(name, label, value); expect(field(name, label).props.value).toBe(value);
    h.facility = "facility-b"; h.resident = "resident-b";
    expect(field(name, label).props.value).toBe("");
  });
  it("keeps unsaved dietary orders across same-resident profile refetches", () => {
    h.profile = { id: "profile", resident_id: "resident-a", diet_order: "Saved diet", food_allergies: [], adaptive_equipment: [], risk_factors: [] };
    fill("ResidentNutrition", "Diet order", "Pending clinical update");
    h.profile = { ...h.profile };
    expect(field("ResidentNutrition", "Diet order").props.value).toBe("Pending clinical update");
  });
  it("does not expose an actionable dietary form for a URL resident absent from the selected facility", () => {
    h.resident = "resident-b";
    expect(nodes(child("ResidentNutrition")).some(node => node.props.onClick)).toBe(false);
  });
  it("does not permit stale resident actions after a failed roster refresh", () => {
    h.residentError = true;
    expect(nodes(child("ResidentNutrition")).some(node => node.props.onClick)).toBe(false);
    expect(nodes(child("ResidentMonitoring")).some(node => node.props.onClick)).toBe(false);
  });
  it("freezes submitted menu entries so completion cannot erase a newly edited cycle", () => {
    h.pending = true;
    expect(nodes(child("MenuOperations")).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true);
  });
});
