import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const h = vi.hoisted(() => ({
  role: "org_admin", filters: {} as Record<string, string>, setFilters: vi.fn(), query: vi.fn(), summary: vi.fn(),
  result: {} as Record<string, unknown>,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useEffect: (fn: () => unknown) => { const cleanup = fn(); if (typeof cleanup === "function") cleanup(); },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me", role: h.role, organizationId: "org" } }) }));
vi.mock("@/lib/viewingOrg", () => ({ useViewingOrg: () => ({ viewingOrgId: null }) }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: (defaults: Record<string, string>) => [{ ...defaults, ...h.filters }, h.setFilters] }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useWorkItems", () => ({ usePaginatedWorkItems: (args: unknown) => { h.query(args); return h.result; } }));
vi.mock("@/hooks/useDomainListSummaries", () => ({ EMPTY_WORK_ITEM_LIST_SUMMARY: {}, useWorkItemListSummary: (args: unknown) => { h.summary(args); return {}; } }));
vi.mock("@/components/workqueue/CreateWorkItemDialog", () => ({ CreateWorkItemDialog: () => null }));
import WorkQueue from "./WorkQueue";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
beforeEach(() => {
  h.role = "org_admin"; h.filters = {}; h.result = { data: { rows: [], count: 0 } };
  h.query.mockClear(); h.summary.mockClear(); h.setFilters.mockClear();
});
describe("work queue navigation", () => {
  it.each(["mine", "facility", "organization"])("applies the visible facility filter in %s scope to both rows and totals", scope => {
    h.filters = { scope, facilityId: "east" };
    WorkQueue();
    expect(h.query).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "east", ownerProfileId: scope === "mine" ? "me" : undefined }));
    expect(h.summary).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "east" }));
  });
  it("ignores facility parameters when the employee has no facility control", () => {
    h.role = "employee"; h.filters = { scope: "organization", facilityId: "east" };
    WorkQueue();
    expect(h.query).toHaveBeenCalledWith(expect.objectContaining({ facilityId: undefined, ownerProfileId: "me" }));
  });
  it("recovers an out-of-range page after the current result is known", () => {
    h.filters = { page: "9" }; h.result = { data: { rows: [], count: 26 } };
    WorkQueue(); expect(h.setFilters).toHaveBeenCalledWith({ page: "2" });
  });
  it.each([{ isFetching: true }, { isPlaceholderData: true }, { isError: true }, { data: undefined }])("does not rewrite a bookmark while current results are unavailable: %o", extra => {
    h.filters = { page: "9" }; h.result = { ...h.result, ...extra };
    WorkQueue(); expect(h.setFilters).not.toHaveBeenCalled();
  });
  it("clears restrictive filters while retaining the chosen workspace scope", () => {
    h.filters = { scope: "organization", priority: "urgent", page: "3" };
    const clear = nodes(WorkQueue()).find(node => node.props.children === "Clear filters")!;
    (clear.props.onClick as () => void)();
    expect(h.setFilters).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "organization", priority: "all", page: "1" }));
  });
  it("links both mobile and desktop titles directly to the same work record", () => {
    h.result = { data: { count: 1, rows: [{ id: "work-1", title: "Review a very long resident assessment", state: "open", priority: "high", due_at: "2026-09-25T12:00:00Z", source_type: "manual", owner: null }] } };
    const titleLinks = nodes(WorkQueue()).filter(node => node.type === "a" && node.props.children === "Review a very long resident assessment");
    expect(titleLinks).toHaveLength(2);
    expect(titleLinks.every(node => node.props.href === "/app/work/work-1")).toBe(true);
  });
});
