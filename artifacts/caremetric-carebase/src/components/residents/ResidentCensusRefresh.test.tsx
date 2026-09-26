import type { ReactElement, ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

type Mutation = { mutationFn: (input: any) => Promise<unknown>; onSuccess: (data?: unknown, input?: any) => void };
const h = vi.hoisted(() => ({
  client: undefined as unknown, mutations: [] as Mutation[], rpc: vi.fn(), toast: vi.fn(),
  state: [] as unknown[], cursor: 0, pending: false,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(), useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }];
  },
}));
vi.mock("@tanstack/react-query", async original => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: () => ({ data: [] }), useQueryClient: () => h.client,
  useMutation: (options: Mutation) => {
    h.mutations.push(options);
    return { isPending: h.pending, mutateAsync: async (input: unknown) => {
      const result = await options.mutationFn(input); options.onSuccess(result, input); return result;
    } };
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useListResidentDocuments: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentAssessmentReviews", () => ({ useResidentAssessmentReviews: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentCareDelivery", () => ({ useResidentSupportPlans: () => ({ data: [] }) }));
import RecordHospitalReturnDialog from "./RecordHospitalReturnDialog";
import ResidentHospitalSection from "./ResidentHospitalSection";
import { useTransitionResidentCensus } from "@/hooks/useAdmissions";

const censusKeys = [
  ["residents", { facilityId: "facility-a" }], ["residents", "resident-a"],
  ["resident-care-header", "resident-a"], ["resident-360", "resident-a"],
  ["resident-timeline", "resident-a", 30], ["resident-service-tasks", { facilityId: "facility-a" }],
  ["resident-care-delivery", "analytics"], ["my-shift-workspace"], ["daily-operations-command-center", "facility-a"],
];
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); h.mutations = []; h.state = []; h.cursor = 0; h.pending = false;
  h.rpc.mockResolvedValue({ data: "saved", error: null });
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } }); h.client = client;
});
function seed(keys: readonly (readonly unknown[])[]) { for (const key of keys) client.setQueryData(key, { previouslyLoaded: true }); }
function expectRefreshed(keys: readonly (readonly unknown[])[]) { for (const key of keys) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true); }
const props = { open: true, onOpenChange: vi.fn(), residentId: "resident-a", episodeId: "episode-a", transferTime: "2026-03-07T14:00:00Z", destination: "Hospital" };
function render() { h.cursor = 0; return RecordHospitalReturnDialog(props); }
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function form(value: string) {
  const field = nodes(render()).find(node => node.props.id === "return-time")!;
  (field.props.onChange as (event: unknown) => void)({ target: { value } });
  return nodes(render()).find(node => node.props.children === "Record return")!;
}
it("refreshes census-dependent resident and task views after discharge", async () => {
  seed(censusKeys); seed([["resident-360", "resident-b"]]);
  useTransitionResidentCensus();
  const input = { residentId: "resident-a", targetStatus: "discharged", reason: "Moved to another facility" };
  const result = await h.mutations[0].mutationFn(input); h.mutations[0].onSuccess(result, input);
  expect(h.rpc).toHaveBeenCalledWith("transition_resident_census", expect.objectContaining({ p_resident_id: "resident-a", p_target_status: "discharged" }));
  expectRefreshed(censusKeys);
  expect(client.getQueryState(["resident-360", "resident-b"])?.isInvalidated).toBe(false);
});
it("refreshes the restored census, scheduled care, and new shift handoff after hospital return", async () => {
  const keys = [...censusKeys, ["hospital-episodes", "resident-a"], ["resident-assessment-reviews", "resident-a"], ["work-items"], ["shift-report-entries", "facility-a"]];
  seed(keys); render();
  const result = await h.mutations[0].mutationFn({ episodeId: "episode-a", returnTime: "2026-03-09T14:00:00Z", changedOrderAckStatus: "not_applicable", medicationReconciliationStatus: "not_applicable", assessmentReviewRequired: false, supportPlanReviewRequired: false });
  h.mutations[0].onSuccess(result);
  expectRefreshed(keys);
});
it("removes a closed hospital reconciliation from cached work and attention queues", async () => {
  const keys = [["work-items", { state: "open" }], ["resident-360", "resident-a"], ["daily-operations-command-center", "facility-a"], ["my-shift-workspace"], ["hospital-episodes", "resident-a"]];
  seed(keys); ResidentHospitalSection({ residentId: "resident-a", residentHref: "/app/residents/resident-a", canManage: true });
  const result = await h.mutations[0].mutationFn({ episodeId: "episode-a", note: "Reviewed" }); h.mutations[0].onSuccess(result);
  expect(h.rpc).toHaveBeenCalledWith("complete_hospital_return_reconciliation", { p_episode_id: "episode-a", p_note: "Reviewed" });
  expectRefreshed(keys);
});
it.each(["", "2026-02-30T10:00", "2026-03-08T02:30", "2026-03-07T08:59"])("refuses an invalid or pre-transfer return time: %s", async value => {
  const button = form(value); expect(button.props.disabled).toBe(true);
  (button.props.onClick as () => void)(); await Promise.resolve();
  expect(h.rpc).not.toHaveBeenCalled();
});
it("records a valid facility-local return with the selected episode identity", async () => {
  const button = form("2026-03-09T10:00"); expect(button.props.disabled).toBe(false);
  (button.props.onClick as () => void)(); await Promise.resolve();
  expect(h.rpc).toHaveBeenCalledWith("complete_hospital_return", expect.objectContaining({ p_episode_id: "episode-a", p_return_time: "2026-03-09T14:00:00.000Z" }));
});
