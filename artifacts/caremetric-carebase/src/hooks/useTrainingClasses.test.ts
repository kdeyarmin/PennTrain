import { beforeEach, describe, expect, it, vi } from "vitest";
type Request = { table: string; filters: unknown[][]; orders: string[]; range: number[] };
const h = vi.hoisted(() => ({ requests: [] as Request[], failSecond: false, cap: 1000, from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListTrainingClasses, useTrainingSessionRegistrations, useTrainingAttendanceEvidence } from "./useTrainingClasses";
const fetchQuery = <T>(query: unknown) => (query as { queryFn: () => Promise<T[]> }).queryFn();
beforeEach(() => {
  h.requests = []; h.failSecond = false; h.cap = 1000; vi.clearAllMocks();
  h.from.mockImplementation((table: string) => {
    const request: Request = { table, filters: [], orders: [], range: [] }; h.requests.push(request);
    const filter = (operator: string) => (key: string, value: unknown) => { request.filters.push([operator, key, value]); return query; };
    const query = {
      select: () => query, eq: filter("eq"), is: filter("is"), in: filter("in"),
      order: (key: string) => { request.orders.push(key); return query; },
      range: (from: number, to: number) => { request.range = [from, to]; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(request.range[0] === 0
        ? { data: Array.from({ length: h.cap }, (_, index) => ({ id: `${table}-${index}` })), error: null }
        : { data: request.range[0] === h.cap ? [{ id: "older-record" }] : [], error: h.failSecond ? new Error("History unavailable") : null }).then(resolve),
    }; return query;
  });
});
describe("complete live training history", () => {
  it("keeps older classes for the calendar and repeats facility/trainer/status filters on each page", async () => {
    const rows = await fetchQuery(useListTrainingClasses({ facilityId: "facility", trainerProfileId: "trainer", enrollableOnly: true }));
    expect(rows).toHaveLength(1001);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
    for (const request of h.requests) {
      expect(request.orders).toEqual(["class_date", "id"]);
      expect(request.filters).toEqual([["eq", "facility_id", "facility"], ["eq", "trainer_profile_id", "trainer"], ["in", "status", ["scheduled", "in_progress"]]]);
    }
  });
  it("preserves cross-facility-only selection on later pages", async () => {
    await fetchQuery(useListTrainingClasses({ crossFacilityOnly: true, facilityId: "ignored" }));
    expect(h.requests.every(request => JSON.stringify(request.filters) === JSON.stringify([["is", "facility_id", null]]))).toBe(true);
  });
  it("includes the complete waitlist in a stable class-scoped order", async () => {
    expect(await fetchQuery(useTrainingSessionRegistrations("class"))).toHaveLength(1001);
    for (const request of h.requests) {
      expect(request.orders).toEqual(["waitlist_position", "id"]);
      expect(request.filters).toEqual([["eq", "class_id", "class"]]);
    }
  });
  it.each([
    ["classes", () => useListTrainingClasses()],
    ["registrations", () => useTrainingSessionRegistrations("class")],
    ["evidence", () => useTrainingAttendanceEvidence(["registration"])],
  ] as const)("rejects a failed later %s page instead of displaying incomplete records", async (_name, query) => {
    h.failSecond = true;
    await expect(fetchQuery(query())).rejects.toThrow("History unavailable");
  });
  it.each([
    ["classes", () => useListTrainingClasses()],
    ["registrations", () => useTrainingSessionRegistrations("class")],
    ["evidence", () => useTrainingAttendanceEvidence(["registration"])],
  ] as const)("continues %s history through a lower server response cap", async (_name, query) => {
    h.cap = 2;
    expect(await fetchQuery(query())).toHaveLength(3);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [2, 1001], [3, 1002]]);
  });
  it("deduplicates and batches registration IDs while retaining later evidence pages", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `registration-${String(index).padStart(3, "0")}`);
    expect(await fetchQuery(useTrainingAttendanceEvidence([...ids, ids[0], ""]))).toHaveLength(2002);
    expect(h.requests).toHaveLength(6);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000], [0, 999], [1000, 1999], [1001, 2000]]);
    expect(h.requests[0].filters).toEqual([["in", "registration_id", ids.slice(0, 100)]]);
    expect(h.requests[1].filters).toEqual(h.requests[0].filters);
    expect(h.requests[2].filters).toEqual(h.requests[0].filters);
    expect(h.requests[3].filters).toEqual([["in", "registration_id", ids.slice(100)]]);
    expect(h.requests[4].filters).toEqual(h.requests[3].filters);
    expect(h.requests[5].filters).toEqual(h.requests[3].filters);
    expect(h.requests.every(request => request.orders.join() === "id")).toBe(true);
  });
});
