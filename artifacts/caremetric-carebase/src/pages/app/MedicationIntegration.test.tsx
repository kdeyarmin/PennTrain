import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, org: "org-a", facility: "facility-a", facilityOrg: "org-a", contextFacility: "facility-a", residentId: "resident-a",
  resident: { id: "resident-a", facility_id: "facility-a" }, facilityError: false, facilityLoading: false, residentError: false, residentLoading: false,
  clinical: vi.fn(), workspace: vi.fn(), retry: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "med", useMemo: (compute: () => unknown) => compute(), useEffect: () => {},
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = value; }]; },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "operator", role: "platform_admin" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: h.org }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: h.facility, organization_id: h.facilityOrg, name: h.facility }], isError: h.facilityError, isLoading: h.facilityLoading }) }));
vi.mock("@/hooks/useResidentNavigationContext", () => ({ useResidentNavigationContext: () => ({ facilityId: h.contextFacility, residentId: h.residentId, linkedResident: { data: h.resident, isError: h.residentError, isLoading: h.residentLoading, refetch: h.retry }, setFacilityId: vi.fn() }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [] }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useIntegrationCredentials", () => ({ credentialIsExpired: () => false, credentialSupportsMedicationWrite: () => true, useOrganizationIntegrationCredentials: () => ({ data: [] }) }));
vi.mock("@/hooks/useMedicationIntegration", () => ({
  useMedicationIntegration: (facilityId?: string) => { h.workspace(facilityId); return { data: { sources: [], exceptions: [], activity: { orderTotal: 0, orderActiveTotal: 0, administrationTotal: 0, nonRoutineTotal: 0, residents: [] } } }; },
  // Retain old cached data deliberately: the UI must not display it after rejecting the target.
  useResidentExternalMedications: (residentId?: string) => { h.clinical(residentId); return { data: { orders: [{ id: "order", resident_id: "resident-a", order_status: "active", medication_display: "Old resident medicine", source_updated_at: "2026-09-26T12:00:00Z" }], administrations: [] } }; },
  medicationSourceEditorStatus: () => "setup_required", useAssignMedicationIntegrationException: () => ({}), useResolveMedicationIntegrationException: () => ({}), useSaveMedicationIntegrationSource: () => ({}), useMapMedicationResident: () => ({}),
}));
import MedicationIntegration from "./MedicationIntegration";
import { QueryError, QueryLoading } from "@/components/QueryState";

type Node = ReactElement<Record<string, unknown>>;
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function tree() { h.cursor = 0; return MedicationIntegration(); }
function render() { return text(tree()); }
beforeEach(() => {
  vi.clearAllMocks(); h.slots = []; h.org = "org-a"; h.facility = "facility-a"; h.facilityOrg = "org-a"; h.contextFacility = "facility-a"; h.residentId = "resident-a";
  h.resident = { id: "resident-a", facility_id: "facility-a" }; h.facilityError = false; h.facilityLoading = false; h.residentError = false; h.residentLoading = false;
});

describe("medication integration resident scope", () => {
  it("keeps a verified resident deep link and its audited clinical read", () => {
    expect(render()).toContain("Old resident medicine"); expect(h.clinical).toHaveBeenLastCalledWith("resident-a");
  });
  it("drops the prior resident's clinical read and cached orders when the viewed organization changes", () => {
    render(); h.org = "org-b"; h.facility = "facility-b"; h.facilityOrg = "org-b";
    expect(render()).not.toContain("Old resident medicine"); expect(h.workspace).toHaveBeenLastCalledWith("facility-b"); expect(h.clinical).toHaveBeenLastCalledWith(undefined);
  });
  it("rejects cached facilities from the prior organization before the new list resolves", () => {
    render(); h.org = "org-b";
    expect(render()).not.toContain("Old resident medicine"); expect(h.workspace).toHaveBeenLastCalledWith(undefined); expect(h.clinical).toHaveBeenLastCalledWith(undefined);
  });
  it.each(["facilityError", "facilityLoading", "residentError", "residentLoading"] as const)("pauses clinical content while %s makes the selected scope unconfirmed", state => {
    render(); h[state] = true;
    expect(render()).not.toContain("Old resident medicine"); expect(h.clinical).toHaveBeenLastCalledWith(undefined);
    h[state] = false; expect(render()).toContain("Old resident medicine");
  });
  it("waits for the replacement URL resident instead of reusing the previous resident result", () => {
    render(); h.residentId = "resident-b";
    expect(render()).not.toContain("Old resident medicine"); expect(h.clinical).toHaveBeenLastCalledWith(undefined);
    h.resident = { id: "resident-b", facility_id: "facility-a" }; render(); expect(h.clinical).toHaveBeenLastCalledWith("resident-b");
  });
  it.each(["residentLoading", "residentError"] as const)("shows recoverable resident state instead of aggregate success during %s", state => {
    h[state] = true; const page = nodes(tree());
    const feedback = page.filter(node => node.type === (state === "residentError" ? QueryError : QueryLoading) && node.props.what === "selected resident");
    expect(feedback).toHaveLength(2); expect(page.some(node => typeof node.type === "function" && node.type.name === "MedicationActivityView")).toBe(false);
    if (state === "residentError") { (feedback[0].props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce(); }
  });
  it("rejects an explicit facility context inconsistent with the resident's actual facility", () => {
    h.facility = "facility-b"; h.contextFacility = "facility-b";
    expect(render()).not.toContain("Old resident medicine"); expect(h.clinical).toHaveBeenLastCalledWith(undefined);
  });
});
