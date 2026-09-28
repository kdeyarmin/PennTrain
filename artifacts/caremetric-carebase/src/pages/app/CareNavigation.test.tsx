import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as (() => void)[], filters: {} as Record<string, string>, setFilters: vi.fn(),
  list: { data: undefined, isLoading: true, isError: false } as Record<string, unknown>,
  items: { data: [], isLoading: false, isError: false } as Record<string, unknown>,
  facilities: { data: [{ id: "facility", name: "Facility" }], isLoading: false, isError: false } as Record<string, unknown>,
  residents: { data: [{ id: "resident", first_name: "A", last_name: "Resident" }], isLoading: false, isError: false } as Record<string, unknown>,
  qr: { data: null, isLoading: false, isError: false } as Record<string, unknown>,
  refetch: vi.fn(), params: { kind: "asset", token: "label" },
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void) => { h.effects.push(effect); },
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
}));
vi.mock("wouter", () => ({ Link: "a", useSearch: () => "", useParams: () => h.params }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: (defaults: Record<string, string>) => [{ ...defaults, ...h.filters }, h.setFilters] }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ ...h.facilities, refetch: h.refetch }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidentNames: () => ({ ...h.residents, refetch: h.refetch }) }));
vi.mock("@/hooks/useResidentComplianceItems", () => ({ useListAllResidentComplianceItems: () => ({ ...h.items, refetch: h.refetch }) }));
vi.mock("@/hooks/useComplaints", () => ({ usePaginatedComplaints: () => ({ ...h.list, refetch: h.refetch }) }));
vi.mock("@/hooks/usePaginatedDomainLists", () => ({ usePaginatedDomainList: () => ({ ...h.list, refetch: h.refetch }) }));
vi.mock("@/hooks/useDomainListSummaries", () => ({
  EMPTY_COMPLAINT_LIST_SUMMARY: {}, EMPTY_CONFIDENTIAL_INTAKE_LIST_SUMMARY: {},
  useComplaintListSummary: () => ({ data: {} }), useConfidentialIntakeListSummary: () => ({ data: {} }),
}));
vi.mock("@/components/complaints/ComplaintTrendsCard", () => ({ ComplaintTrendsCard: "section" }));
vi.mock("@/components/complaints/ComplaintDeadlines", () => ({ ComplaintDeadlines: "span" }));
vi.mock("@/components/complaints/CreateComplaintDialog", () => ({ CreateComplaintDialog: "dialog", COMPLAINT_CATEGORIES: [], COMPLAINT_STATUSES: [], humanizeComplaint: (v: string) => v }));
vi.mock("@/hooks/useInspectionItems", () => ({ useGetInspectionItemByQrToken: () => ({ ...h.qr, refetch: h.refetch }) }));
vi.mock("@/hooks/useWorkOrders", () => ({ useGetMaintenanceLocationByQrToken: () => ({ ...h.qr, refetch: h.refetch }) }));
import ResidentComplianceReport from "./ResidentComplianceReport";
import Complaints from "./Complaints";
import ConfidentialIncidents from "./ConfidentialIncidents";
import MaintenanceScan from "./MaintenanceScan";
import { QueryError } from "@/components/QueryState";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
beforeEach(() => {
  vi.clearAllMocks(); h.effects = []; h.filters = {};
  h.list = { data: undefined, isLoading: true, isError: false };
  h.items = { data: [], isLoading: false, isError: false };
  h.facilities = { data: [{ id: "facility", name: "Facility" }], isLoading: false, isError: false };
  h.residents = { data: [{ id: "resident", first_name: "A", last_name: "Resident" }], isLoading: false, isError: false };
  h.qr = { data: null, isLoading: false, isError: false };
});
describe("care workspace navigation and recovery", () => {
  it("takes a compliance deadline directly to the resident's assessment checklist", () => {
    h.items.data = [{ id: "item", resident_id: "resident", facility_id: "facility", item_type: "initial_assessment", status: "missing" }];
    expect(nodes(ResidentComplianceReport()).some(node => node.props.href === "/app/residents/resident?tab=assessments")).toBe(true);
  });
  it("keeps compliance filters in the URL and offers a complete reset", () => {
    h.filters = { facility: "facility", status: "missing", itemType: "initial_assessment" };
    const page = ResidentComplianceReport();
    expect(nodes(page).some(node => node.props.value === "missing")).toBe(true);
    const reset = nodes(page).find(node => node.props.onClick && text(node.props.children as ReactNode) === "Clear filters")!;
    (reset.props.onClick as () => void)();
    expect(h.setFilters).toHaveBeenCalledWith({ facility: "all", status: "all", itemType: "all" });
  });
  it("never presents a failed compliance query as an empty successful report", () => {
    h.items.isError = true;
    const page = ResidentComplianceReport();
    expect(text(page)).not.toContain("Nothing matches these filters.");
    const failure = nodes(page).find(node => node.type === QueryError)!;
    (failure.props.onRetry as () => void)();
    expect(h.refetch).toHaveBeenCalledTimes(3);
  });
  it("waits for resident names before showing an empty compliance report", () => {
    h.residents.isLoading = true;
    expect(text(ResidentComplianceReport())).not.toContain("Nothing matches these filters.");
  });
  for (const [label, Page] of [["complaints", Complaints], ["confidential reports", ConfidentialIncidents]] as const) {
    it(`preserves a bookmarked ${label} page until the count is known, then recovers a removed page`, () => {
      h.filters = { page: "9" }; Page(); h.effects.splice(0).forEach(effect => effect());
      expect(h.setFilters).not.toHaveBeenCalled();
      h.list = { data: { rows: [], count: 26 }, isLoading: false, isError: false };
      Page(); h.effects.splice(0).forEach(effect => effect());
      expect(h.setFilters).toHaveBeenCalledWith({ page: "2" });
    });
    it(`does not rewrite the ${label} URL using a failed request`, () => {
      h.filters = { page: "9" }; h.list = { data: { rows: [], count: 0 }, isError: true };
      Page(); h.effects.splice(0).forEach(effect => effect());
      expect(h.setFilters).not.toHaveBeenCalled();
    });
    it(`preserves the ${label} page while a different filter's count is shown temporarily`, () => {
      h.filters = { page: "9" }; h.list = { data: { rows: [], count: 0 }, isError: false, isPlaceholderData: true };
      Page(); h.effects.splice(0).forEach(effect => effect());
      expect(h.setFilters).not.toHaveBeenCalled();
    });
  }
  it("offers retry for a failed maintenance QR lookup instead of calling the label retired", () => {
    h.qr.isError = true;
    const page = MaintenanceScan();
    expect(text(page)).not.toContain("Maintenance QR code not found");
    const failure = nodes(page).find(node => node.type === QueryError)!;
    (failure.props.onRetry as () => void)(); expect(h.refetch).toHaveBeenCalledOnce();
    expect(nodes(page).some(node => node.props.href === "/app/maintenance")).toBe(true);
  });
});
