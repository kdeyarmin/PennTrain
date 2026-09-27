import { beforeEach, describe, expect, it, vi } from "vitest";

type Request = { table: string; range: number[]; filters: unknown[][]; order: unknown[][] };
const h = vi.hoisted(() => ({ from: vi.fn(), requests: [] as Request[], failAt: -1 }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, rpc: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListAlerts } from "./useAlerts";
import { useComplianceInstances } from "./useComplianceRequirements";
import { useListCorrectiveActions } from "./useCorrectiveActions";
import { useListCourseAssignments } from "./useCourseAssignments";
import { useListShiftReportEntries } from "./useDailyOperations";
import { useListEmployees } from "./useEmployees";
import { useListIncidents } from "./useIncidents";
import { useListInspectionItems } from "./useInspectionItems";
import { useListShiftAssignments } from "./useShiftAssignments";
import { useClassAttendeeCounts } from "./useTrainingClasses";
import { useListTrainingRecords } from "./useTrainingRecords";
import { useListWorkItems } from "./useWorkItems";

const rows = [{ id: "first", class_id: "class-a" }, { id: "second", class_id: "class-a" }, { id: "last", class_id: "class-b" }];
const cases: Array<[string, () => unknown, unknown[] | undefined]> = [
  ["alerts", () => useListAlerts({ facilityId: "facility" }), ["eq", "facility_id", "facility"]],
  ["compliance instances", () => useComplianceInstances(), undefined],
  ["corrective actions", () => useListCorrectiveActions({ incidentId: "incident" }), ["eq", "incident_id", "incident"]],
  ["course assignments", () => useListCourseAssignments({ employeeId: "employee" }), ["eq", "employee_id", "employee"]],
  ["shift reports", () => useListShiftReportEntries("facility"), ["eq", "facility_id", "facility"]],
  ["employees", () => useListEmployees({ organizationId: "org" }), ["eq", "organization_id", "org"]],
  ["incidents", () => useListIncidents({ residentId: "resident" }), ["eq", "resident_id", "resident"]],
  ["inspection items", () => useListInspectionItems({ facilityId: "facility" }), ["eq", "facility_id", "facility"]],
  ["shift assignments", () => useListShiftAssignments({ scheduleId: "schedule" }), ["eq", "schedule_id", "schedule"]],
  ["class attendee counts", () => useClassAttendeeCounts(), undefined],
  ["training records", () => useListTrainingRecords({ employeeId: "employee" }), ["eq", "employee_id", "employee"]],
  ["work items", () => useListWorkItems({ organizationId: "org" }), ["eq", "organization_id", "org"]],
];
const run = (hook: () => unknown) => (hook() as { queryFn: () => Promise<unknown> }).queryFn();
beforeEach(() => {
  vi.clearAllMocks(); h.requests = []; h.failAt = -1;
  h.from.mockImplementation((table: string) => {
    const request: Request = { table, range: [], filters: [], order: [] }; h.requests.push(request);
    const query: object = new Proxy({}, { get: (_target, property) => {
      if (property === "then") return (resolve: (result: unknown) => unknown) => {
        const offset = request.range[0];
        return Promise.resolve({ data: rows.slice(offset, offset + 2), error: offset === h.failAt ? new Error("Later page unavailable") : null }).then(resolve);
      };
      return (...args: unknown[]) => {
        if (property === "range") request.range = args as number[];
        else if (property === "order") request.order.push(args);
        else if (property !== "select") request.filters.push([property, ...args]);
        return query;
      };
    } });
    return query;
  });
});

describe("complete operational lists under a reduced server row cap", () => {
  it.each(cases)("retrieves every %s row and retains scoped ordering through the empty final page", async (name, hook, scope) => {
    const result = await run(hook);
    expect(result).toEqual(name === "class attendee counts" ? { "class-a": 2, "class-b": 1 } : rows);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [2, 1001], [3, 1002]]);
    for (const request of h.requests) {
      expect(request.order).toEqual(h.requests[0].order);
      expect(request.order.some(order => order[0] === "id")).toBe(true);
      expect(request.filters).toEqual(h.requests[0].filters);
      if (scope) expect(request.filters).toContainEqual(scope);
    }
  });
  it.each(cases)("rejects incomplete %s results after a lower-cap page succeeds", async (_name, hook) => {
    h.failAt = 2;
    await expect(run(hook)).rejects.toThrow("Later page unavailable");
    expect(h.requests.map(request => request.range[0])).toEqual([0, 2]);
  });
});
