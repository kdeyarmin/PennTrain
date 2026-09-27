import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useFacilityTransportVehicles, useResidentServicesCalendar } from "./useResidentServicesCalendar";
beforeEach(() => vi.clearAllMocks());
describe("complete resident calendar reads", () => {
  function setup(failAt?: number) {
    const calls: Array<{ table: string; filters: Record<string, string>; order: string[]; start: number; signal?: AbortSignal }> = [];
    h.from.mockImplementation((table: string) => {
      const call = { table, filters: {} as Record<string, string>, order: [] as string[], start: 0, signal: undefined as AbortSignal | undefined }; calls.push(call);
      const q = { select: () => q, eq: (column: string, value: string) => { call.filters[column] = value; return q; }, gte: (column: string, value: string) => { call.filters[`gte:${column}`] = value; return q; }, lt: (column: string, value: string) => { call.filters[`lt:${column}`] = value; return q; }, order: (column: string) => { call.order.push(column); return q; }, range: (start: number) => { call.start = start; return q; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: ["one", "two", "three"].slice(call.start, call.start + 2).map(id => ({ id })), error: call.start === failAt ? new Error("Later page failed") : null })) }; return q;
    }); return calls;
  }
  it.each(["events", "vehicles"])("reads all %s under a lower API cap with stable ordering and cancellation", async kind => {
    const calls = setup(), signal = new AbortController().signal;
    if (kind === "events") useResidentServicesCalendar({ organizationId: "organization", facilityId: "facility", residentId: "resident", eventType: "therapy", status: "scheduled", from: "from", through: "through" }); else useFacilityTransportVehicles("facility");
    expect(await h.query.mock.calls[0][0].queryFn({ signal })).toEqual([{ id: "one" }, { id: "two" }, { id: "three" }]);
    expect(calls.map(call => call.start)).toEqual([0, 2, 3]);
    for (const call of calls) { expect(call.signal).toBe(signal); expect(call.order).toEqual([kind === "events" ? "starts_at" : "label", "id"]); expect(call.filters).toEqual(kind === "events" ? { organization_id: "organization", facility_id: "facility", resident_id: "resident", event_type: "therapy", status: "scheduled", "gte:starts_at": "from", "lt:starts_at": "through" } : { facility_id: "facility" }); }
  });
  it.each(["events", "vehicles"])("rejects a failed later %s page instead of displaying an incomplete collection", async kind => {
    setup(2); if (kind === "events") useResidentServicesCalendar({ from: "from", through: "through" }); else useFacilityTransportVehicles("facility");
    await expect(h.query.mock.calls[0][0].queryFn({ signal: new AbortController().signal })).rejects.toThrow("Later page failed");
  });
  it("supports pausing invalid date-range requests", () => { useResidentServicesCalendar({ from: "", through: "" }, { enabled: false }); expect(h.query.mock.calls[0][0].enabled).toBe(false); });
});
