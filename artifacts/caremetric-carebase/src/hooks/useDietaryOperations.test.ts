import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; from: number; through: number; filters: unknown[][]; orders: string[]; signal?: AbortSignal }>,
  count: 5, cap: 2, failTable: "",
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => {
  let singleton = false;
  const call = { table, from: 0, through: Infinity, filters: [] as unknown[][], orders: [] as string[], signal: undefined as AbortSignal | undefined };
  const builder: any = {
    select: () => builder,
    eq: (...filter: unknown[]) => { call.filters.push(filter); return builder; },
    order: (column: string) => { call.orders.push(column); return builder; },
    limit: (count: number) => { call.through = count - 1; return builder; },
    range: (from: number, through: number) => { call.from = from; call.through = through; return builder; },
    abortSignal: (signal: AbortSignal) => { call.signal = signal; return builder; },
    maybeSingle: () => { singleton = true; return builder; },
    then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
      h.calls.push(call);
      const error = table === h.failTable && call.from >= 2 ? new Error("Later page failed") : null;
      const all = Array.from({ length: h.count }, (_, index) => ({ id: `${table}-${index}` }));
      const data = singleton ? { id: "profile" } : all.slice(call.from, Math.min(call.through + 1, call.from + h.cap));
      return Promise.resolve({ data: error ? null : data, error }).then(resolve, reject);
    },
  };
  return builder;
} } }));
import { useDietaryOperations } from "./useDietaryOperations";

const collections = [
  ["dietary_menu_cycles", "menus", "facility_id", "starts_on", Infinity],
  ["resident_meal_records", "meals", "resident_id", "served_at", 30],
  ["resident_hydration_rounds", "hydration", "resident_id", "scheduled_at", 30],
  ["weight_monitoring_assignments", "assignments", "resident_id", "created_at", Infinity],
  ["resident_weight_readings", "readings", "resident_id", "measured_at", 30],
  ["nutrition_risk_reviews", "reviews", "resident_id", "reviewed_at", 30],
  ["food_safety_control_points", "controls", "facility_id", "label", Infinity],
  ["food_safety_logs", "logs", "facility_id", "observed_at", 50],
  ["food_service_employee_qualifications", "qualifications", "facility_id", "updated_at", Infinity],
] as const;
const signal = new AbortController().signal;
function query() { return useDietaryOperations("facility-A", "resident-A") as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<Record<string, any>>; enabled: boolean }; }
beforeEach(() => { h.calls = []; h.count = 5; h.cap = 2; h.failTable = ""; });

describe("dietary collection completeness", () => {
  it.each(collections)("reads every %s page under a lower server cap with stable scope and cancellation", async (table, key, filter, order) => {
    const result = await query().queryFn({ signal });
    expect(result[key].map((row: { id: string }) => row.id)).toEqual(Array.from({ length: 5 }, (_, index) => `${table}-${index}`));
    const calls = h.calls.filter(call => call.table === table);
    expect(calls.map(call => call.from)).toEqual([0, 2, 4, 5]);
    for (const call of calls) {
      expect(call.filters).toContainEqual([filter, filter === "facility_id" ? "facility-A" : "resident-A"]);
      expect(call.orders).toEqual([order, "id"]);
      expect(call.signal).toBe(signal);
    }
    expect(result.profile).toEqual({ id: "profile" });
  });
  it.each(collections)("rejects the entire dietary snapshot when a later %s page fails", async table => {
    h.failTable = table;
    await expect(query().queryFn({ signal })).rejects.toThrow("Later page failed");
  });
  it("preserves the explicit 30/50 recent-history limits without hiding unbounded reference rows", async () => {
    h.count = 63; h.cap = 7;
    const result = await query().queryFn({ signal });
    for (const [table, key, , , limit] of collections) {
      expect(result[key]).toHaveLength(Math.min(63, limit));
      expect(h.calls.filter(call => call.table === table).every(call => call.through < limit)).toBe(true);
    }
  });
  it("does not enable a query before a facility is selected", () => {
    expect((useDietaryOperations() as unknown as { enabled: boolean }).enabled).toBe(false);
  });
});
