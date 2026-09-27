import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>, cleanups: [] as Array<unknown>,
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  org: "org-a", actor: "operator", role: "org_admin", residentFacility: "stale-facility", facility: "a",
  save: vi.fn(), map: vi.fn(), resolve: vi.fn(), toast: vi.fn(), selectFacility: vi.fn(), facilityError: false, retryFacilities: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "review", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }];
  },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectCursor++;
    if (!deps || !h.deps[index] || deps.some((dep, i) => !Object.is(dep, h.deps[index]?.[i]))) {
      h.effects.push(() => { if (typeof h.cleanups[index] === "function") (h.cleanups[index] as () => void)(); h.cleanups[index] = effect(); }); h.deps[index] = deps;
    }
  },
}));


vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: h.actor, role: h.role, organizationId: h.org } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.org }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/components/facilities/FhirWritebackSettings", () => ({ FhirWritebackSettings: "writeback" }));
vi.mock("@/hooks/useResidentNavigationContext", () => ({ useResidentNavigationContext: () => ({ facilityId: h.residentFacility, setFacilityId: h.selectFacility }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: ["a", "b"].map(id => ({ id, name: id, organization_id: h.org })), isError: h.facilityError, error: new Error("Facility lookup failed"), refetch: h.retryFacilities }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [{ id: "resident", first_name: "Pat", last_name: "Resident" }] }) }));
vi.mock("@/hooks/useIntegrationCredentials", () => ({ useOrganizationIntegrationCredentials: () => ({ data: [] }), credentialIsExpired: () => false }));
vi.mock("@/hooks/useFhirIntegration", () => ({
  useFhirIntegration: () => ({ data: { sources: [], mappedPatientCount: 0, activity: { requestTotal: 0, requestActiveTotal: 0, administrationTotal: 0, lastRequestAt: null, lastAdministrationAt: null, residents: [] }, exceptions: ["a", "b"].map(id => ({ id, source_id: `source-${id}`, fhir_patient_id: `patient-${id}`, exception_type: "unmatched_patient", status: "open", severity: "warning", summary: id })) } }),
  useSaveFhirIntegrationSource: () => ({ mutateAsync: h.save }), useMapFhirPatient: () => ({ mutateAsync: h.map }), useResolveFhirIntegrationException: () => ({ mutateAsync: h.resolve }),
}));
import FhirIntegration, { FhirFacilityWorkspace } from "./FhirIntegration";
import { useListFacilities } from "@/hooks/useFacilities";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function render(Page: () => ReactNode) {
  for (let i = 0; i < 12; i++) { h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false; const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree; }
  throw new Error("Page did not settle");
}
const click = (node: Node) => (node.props.onClick as () => unknown)();
const textMatches = (node: Node, text: string) => node.props.children === text || Array.isArray(node.props.children) && node.props.children.some(child => typeof child === "string" && child.trim() === text);
const change = (Page: () => ReactNode, id: string, value: string) => (render(Page).find(node => node.props.id === id)!.props.onChange as (event: unknown) => void)({ target: { value } });
const unmount = () => { h.cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); }); h.cleanups = []; };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

const Page = () => FhirFacilityWorkspace({ facilityId: h.facility, facilities: useListFacilities(), scopeOrgId: h.org, onFacilityChange: h.selectFacility });
const button = (label: string, index = 0) => render(Page).filter(node => textMatches(node, label) && node.props.onClick)[index];
const dialog = (index: number) => render(Page).filter(node => node.props.onOpenChange)[index];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.org = "org-a"; h.actor = "operator"; h.role = "org_admin"; h.facility = "a"; h.residentFacility = "stale-facility"; h.facilityError = false; });
afterEach(unmount);
describe("FHIR workspace review identity", () => {
  it("offers facility lookup recovery instead of presenting an empty integration", () => {
    h.facilityError = true;
    const retry = render(Page).find(node => node.props.what === "integration facilities")!;
    expect(retry).toBeDefined();
    (retry.props.onRetry as () => void)();
    expect(h.retryFacilities).toHaveBeenCalledOnce();
    expect(button("Configure source").props.disabled).toBe(true);
    expect(render(Page).filter(node => node.props.onClick && textMatches(node, "Map patient")).every(node => node.props.disabled)).toBe(true);
  });
  it("explains unavailable facility scope and prevents opening an unusable source form", () => {
    h.facility = "";
    expect(render(Page).some(node => node.props.children === "Select a facility to continue")).toBe(true);
    expect(button("Configure source").props.disabled).toBe(true);
  });
  it("drops an out-of-scope resident facility and remounts drafts for facility, organization and actor changes", () => {
    const first = render(FhirIntegration)[0]; expect(first.props.facilityId).toBe("a");
    (first.props.onFacilityChange as (id: string) => void)("b");
    const second = render(FhirIntegration)[0]; expect(second.props.facilityId).toBe("b"); expect(second.key).not.toBe(first.key);
    h.org = "org-b"; const third = render(FhirIntegration)[0]; expect(third.key).not.toBe(second.key);
    h.actor = "replacement"; expect(render(FhirIntegration)[0].key).not.toBe(third.key);
  });
  it("does not erase a newly opened source draft when a previous save finishes", async () => {
    const pending = deferred<void>(); h.save.mockReturnValueOnce(pending.promise);
    click(button("Configure source")); change(Page, "fhir-source-name", "First source"); click(button("Save source"));
    (dialog(0).props.onOpenChange as (open: boolean) => void)(false); click(button("Configure source")); change(Page, "fhir-source-name", "Second source");
    pending.resolve(); await flush(); expect(dialog(0).props.open).toBe(true); expect(render(Page).find(node => node.props.id === "fhir-source-name")!.props.value).toBe("Second source"); expect(h.toast).not.toHaveBeenCalled();
  });
  it("ignores a source completion after leaving its facility workspace", async () => {
    const pending = deferred<void>(); h.save.mockReturnValueOnce(pending.promise); click(button("Configure source")); click(button("Save source")); unmount(); const snapshot = [...h.state]; pending.resolve(); await flush(); expect(h.state).toEqual(snapshot); expect(h.toast).not.toHaveBeenCalled();
  });
  it("keeps a newly opened patient mapping after an old mapping completes", async () => {
    const pending = deferred<void>(); h.map.mockReturnValueOnce(pending.promise); click(button("Map patient"));
    const residentPicker = render(Page).find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props.id === "review-resident"))!;
    (residentPicker.props.onValueChange as (value: string) => void)("resident");
    const submit = render(Page).find(node => node.props.children === "Map patient" && node.props.onClick)!; click(submit);
    (dialog(1).props.onOpenChange as (open: boolean) => void)(false); click(button("Map patient", 1)); pending.resolve(); await flush();
    expect(dialog(1).props.open).toBe(true); expect(render(Page).find(node => node.props.id === "fhir-map-patient-id")!.props.value).toBe("patient-b"); expect(h.toast).not.toHaveBeenCalled();
  });
  it("keeps a newly opened exception review after an old disposition completes", async () => {
    const pending = deferred<void>(); h.resolve.mockReturnValueOnce(pending.promise); click(button("Review")); change(Page, "fhir-resolution-note", "Confirmed external correction"); click(button("Save disposition"));
    (dialog(2).props.onOpenChange as (open: boolean) => void)(false); click(button("Review", 1)); change(Page, "fhir-resolution-note", "New review draft"); pending.resolve(); await flush();
    expect(dialog(2).props.open).toBe(true); expect(render(Page).find(node => node.props.id === "fhir-resolution-note")!.props.value).toBe("New review draft"); expect(h.toast).not.toHaveBeenCalled();
  });
  it("permits the current source save to finish and leaves read-only roles without management controls", async () => {
    h.save.mockResolvedValueOnce(undefined); click(button("Configure source")); click(button("Save source")); await flush(); expect(dialog(0).props.open).toBe(false); expect(h.toast).toHaveBeenCalledWith({ title: "FHIR source saved" });
    h.role = "caregiver"; expect(button("Configure source")).toBeUndefined();
  });
});
