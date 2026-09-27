import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListResidentServiceRequirements, useListServiceTaskAlerts, useResidentServiceTaskQueue } from "./useResidentServiceTasks";

type Call = { name: string; args?: unknown; range?: number[]; filters: Record<string, unknown>; order: Array<[string, unknown]> };
let calls: Call[];
let failSecondPage: boolean;

beforeEach(() => {
  vi.clearAllMocks(); calls = []; failSecondPage = false;
  const builder = (name: string, args?: unknown) => {
    const call: Call = { name, args, filters: {}, order: [] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { call.filters[column] = value; return query; },
      order: (column: string, options?: unknown) => { call.order.push([column, options]); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        const from = call.range?.[0] ?? 0;
        return Promise.resolve(resolve(failSecondPage && from === 1000
          ? { data: null, error: new Error("Service queue page unavailable") }
          : { error: null, data: Array.from({ length: from === 0 ? 1000 : from === 1000 ? 1 : 0 }, (_, id) => ({ id: `row-${from + id}` })) }));
      },
    };
    return query;
  };
  mocks.from.mockImplementation(builder); mocks.rpc.mockImplementation(builder);
});

describe("complete daily care queues", () => {
  it("retains tasks after the 1000-row API cap with stable time-first ordering", async () => {
    const filters = { from: "2026-09-26T04:00:00Z", through: "2026-09-27T04:00:00Z", facilityId: "facility-a", status: "scheduled" };
    useResidentServiceTaskQueue(filters);
    const rows = await mocks.useQuery.mock.calls[0][0].queryFn();
    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)).toEqual({ id: "row-1000" });
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
    for (const call of calls) {
      expect(call.name).toBe("get_resident_service_task_queue");
      expect(call.args).toEqual({ p_from: filters.from, p_through: filters.through, p_facility_id: "facility-a", p_status: "scheduled" });
      expect(call.order.map(([column]) => column)).toEqual(["scheduled_start", "resident_name", "service_name", "id"]);
    }
  });

  it("retains every active service requirement using the same scope on each page", async () => {
    useListResidentServiceRequirements({ organizationId: "org-a", facilityId: "facility-a", residentId: "resident-a", status: "active" });
    expect(await mocks.useQuery.mock.calls[0][0].queryFn()).toHaveLength(1001);
    for (const call of calls) {
      expect(call.filters).toEqual({ organization_id: "org-a", facility_id: "facility-a", resident_id: "resident-a", status: "active" });
      expect(call.order.map(([column]) => column)).toEqual(["service_name", "id"]);
    }
  });

  it("retains older open alerts with stable newest-first ordering", async () => {
    useListServiceTaskAlerts({ organizationId: "org-a", facilityId: "facility-a", status: "open" });
    expect(await mocks.useQuery.mock.calls[0][0].queryFn()).toHaveLength(1001);
    for (const call of calls) {
      expect(call.filters).toEqual({ organization_id: "org-a", facility_id: "facility-a", status: "open" });
      expect(call.order).toEqual([["created_at", { ascending: false }], ["id", { ascending: false }]]);
    }
  });

  it("does not report a partial day as complete when a later task page fails", async () => {
    failSecondPage = true;
    useResidentServiceTaskQueue({ from: "2026-09-26T04:00:00Z", through: "2026-09-27T04:00:00Z" });
    await expect(mocks.useQuery.mock.calls[0][0].queryFn()).rejects.toThrow("Service queue page unavailable");
  });
});
