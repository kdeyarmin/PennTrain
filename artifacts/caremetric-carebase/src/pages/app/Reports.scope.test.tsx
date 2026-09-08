import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the page's event handlers and subsequent render with a small hook-state harness.
// No DOM is needed: the regression is a stale React state closure at the RPC boundary.
const harness = vi.hoisted(() => ({
  state: [] as unknown[],
  cursor: 0,
  rpc: vi.fn(),
  download: vi.fn(),
  toast: vi.fn(),
  savedFacility: "facility-east" as string | undefined,
  savedDateFrom: "2026-01-01" as string | undefined,
  savedDateTo: "2026-09-08" as string | undefined,
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useId: () => "report-test",
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = typeof initial === "function" ? initial() : initial;
    return [harness.state[index], (next: unknown) => {
      harness.state[index] = typeof next === "function" ? next(harness.state[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = { current: initial };
    return harness.state[index];
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: harness.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin", role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/lib/browserDownload", () => ({ downloadCsvText: harness.download }));
vi.mock("@/hooks/useFacilities", () => ({
  useListFacilities: () => ({ data: [
    { id: "facility-east", name: "East Facility", is_sandbox: false },
    { id: "facility-west", name: "West Facility", is_sandbox: false },
  ] }),
}));
vi.mock("@/hooks/useSavedReports", () => ({
  useListSavedReportViews: () => ({ data: [{
    id: "saved-view", name: "Saved facility report", owner_profile_id: "admin",
    current_version: { filters: {
      reportId: "expired-training", facilityId: harness.savedFacility,
      dateFrom: harness.savedDateFrom, dateTo: harness.savedDateTo,
    } },
  }] }),
  useSaveReportView: () => ({ mutate: vi.fn() }),
  useDeleteReportView: () => ({ mutate: vi.fn() }),
}));

import Reports from "./Reports";

type Node = ReactElement<Record<string, unknown>>;

function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}

function renderPage() {
  harness.cursor = 0;
  return nodes(Reports());
}

function savedButton() {
  return renderPage().find((node) => node.type === "button" && node.props.children === "Saved facility report")!;
}

function viewer() {
  return renderPage().find((node) => typeof node.props.onExportCsv === "function")!;
}

function selectFacility(facilityId: string) {
  const picker = renderPage().find((node) => (
    typeof node.props.onValueChange === "function"
    && nodes(node.props.children as ReactNode).some((child) => child.props["aria-label"] === "Facility")
  ))!;
  (picker.props.onValueChange as (value: string) => void)(facilityId);
}

const reportResponse = () => ({
  data: {
    headers: ["Employee"], rows: [["East Employee"]], summaryCards: [],
    generatedAt: "2026-09-08T12:00:00Z", totalRows: 1, pageSize: 100, pageOffset: 0, hasMore: false,
  },
  error: null,
});

beforeEach(() => {
  harness.state = [];
  harness.cursor = 0;
  harness.savedFacility = "facility-east";
  harness.savedDateFrom = "2026-01-01";
  harness.savedDateTo = "2026-09-08";
  harness.rpc.mockReset().mockResolvedValue(reportResponse());
  harness.download.mockReset();
  harness.toast.mockReset();
});

describe("saved report facility scope", () => {
  it("uses the saved facility immediately, even before the picker state renders", async () => {
    selectFacility("facility-west");
    (savedButton().props.onClick as () => void)();
    await vi.waitFor(() => expect(viewer()).toBeDefined());
    expect(harness.rpc).toHaveBeenCalledWith("generate_paged_compliance_report", expect.objectContaining({
      p_facility_id: "facility-east", p_date_from: "2026-01-01", p_date_to: "2026-09-08",
    }));
    expect(viewer().props.facilityName).toBe("East Facility");
  });

  it("runs an all-facilities saved view without retaining the previous facility", async () => {
    harness.savedFacility = undefined;
    selectFacility("facility-west");
    (savedButton().props.onClick as () => void)();
    await vi.waitFor(() => expect(viewer()).toBeDefined());
    expect(harness.rpc).toHaveBeenCalledWith("generate_paged_compliance_report", expect.objectContaining({ p_facility_id: undefined }));
    expect(viewer().props.facilityName).toBeUndefined();
  });

  it("keeps the report label, later pages and CSV on the requested facility after an in-flight picker change", async () => {
    let resolveReport!: (value: ReturnType<typeof reportResponse>) => void;
    harness.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveReport = resolve; }));
    (savedButton().props.onClick as () => void)();
    selectFacility("facility-west");
    resolveReport(reportResponse());
    await vi.waitFor(() => expect(viewer()).toBeDefined());
    expect(viewer().props.facilityName).toBe("East Facility");

    (viewer().props.onPageChange as (offset: number) => void)(100);
    await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(2));
    expect(harness.rpc.mock.calls[1][1]).toMatchObject({ p_facility_id: "facility-east", p_offset: 100 });

    (viewer().props.onExportCsv as () => void)();
    await vi.waitFor(() => expect(harness.download).toHaveBeenCalledTimes(1));
    expect(harness.rpc.mock.calls[2][1]).toMatchObject({ p_facility_id: "facility-east", p_limit: 1000 });
  });

  it("keeps blank date bounds blank for paging and CSV after in-flight date edits", async () => {
    harness.savedDateFrom = undefined;
    harness.savedDateTo = undefined;
    let resolveReport!: (value: ReturnType<typeof reportResponse>) => void;
    harness.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveReport = resolve; }));
    (savedButton().props.onClick as () => void)();
    for (const id of ["report-date-from", "report-date-to"]) {
      const input = renderPage().find((node) => node.props.id === id)!;
      (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "2026-09-01" } });
    }
    resolveReport(reportResponse());
    await vi.waitFor(() => expect(viewer()).toBeDefined());
    (viewer().props.onPageChange as (offset: number) => void)(100);
    await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledTimes(2));
    (viewer().props.onExportCsv as () => void)();
    await vi.waitFor(() => expect(harness.download).toHaveBeenCalledOnce());
    for (const [, args] of harness.rpc.mock.calls) {
      expect(args).toMatchObject({ p_date_from: undefined, p_date_to: undefined });
    }
  });
});
