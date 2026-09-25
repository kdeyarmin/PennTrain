import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useListResidentChangeEvents } from "./useResidentChangeEvents";

interface PageCall {
  range?: [number, number];
  order: string[];
  filters: Array<[string, unknown]>;
}

let calls: PageCall[];
let eventCount: number;
let failOffset: number | undefined;

beforeEach(() => {
  calls = [];
  eventCount = 1001;
  failOffset = undefined;
  mocks.useQuery.mockReset();
  mocks.from.mockReset().mockImplementation(() => {
    const call: PageCall = { order: [], filters: [] };
    calls.push(call);
    const query = {
      select: () => query,
      order: (column: string) => { call.order.push(column); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      then: (resolve: (result: unknown) => unknown) => {
        // Model the API's default cap, including when the client omits range(). Historical
        // closed events fill page one; the latest pending follow-up is on page two.
        const [from, to] = call.range ?? [0, 999];
        return Promise.resolve(resolve({
          data: failOffset === from ? null : Array.from(
            { length: Math.max(0, Math.min(to + 1, eventCount) - from) },
            (_, index) => ({
              id: `event-${from + index}`,
              status: from + index === 1000 ? "follow_up_due" : "closed",
              follow_up_due_at: "2026-09-10T12:00:00Z",
            }),
          ),
          error: failOffset === from ? new Error("Follow-up page unavailable") : null,
        }));
      },
    };
    return query;
  });
});

const queryFn = () => (mocks.useQuery.mock.calls.at(-1)![0] as {
  queryFn: () => Promise<Array<{ id: string; status: string }>>;
}).queryFn();

describe("complete change-of-condition queues", () => {
  it("keeps new active follow-ups visible after 1,000 historical closed events", async () => {
    useListResidentChangeEvents({ organizationId: "org-a", facilityId: "facility-a" });
    const rows = await queryFn();
    expect(rows).toHaveLength(1001);
    expect(rows.filter((row) => row.status !== "closed")).toEqual([
      expect.objectContaining({ id: "event-1000", status: "follow_up_due" }),
    ]);
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of calls) {
      expect(call.order).toEqual(["follow_up_due_at", "id"]);
      expect(call.filters).toEqual([["organization_id", "org-a"], ["facility_id", "facility-a"]]);
    }
  });

  it("preserves resident, assignee, status and category scope on every page", async () => {
    useListResidentChangeEvents({
      residentId: "resident-a", assignedProfileId: "caregiver-a", status: "monitoring", category: "fall",
    });
    await queryFn();
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.filters).toEqual([
      ["resident_id", "resident-a"], ["status", "monitoring"],
      ["assigned_profile_id", "caregiver-a"], ["category", "fall"],
    ]);
  });

  it("rejects a partial result when a later page cannot load", async () => {
    failOffset = 1000;
    useListResidentChangeEvents();
    await expect(queryFn()).rejects.toThrow("Follow-up page unavailable");
  });

  it("stops after the empty page when history exactly fills a page", async () => {
    eventCount = 1000;
    useListResidentChangeEvents();
    expect(await queryFn()).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
});
