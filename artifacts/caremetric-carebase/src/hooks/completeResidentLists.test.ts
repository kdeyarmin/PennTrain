import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ query: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "actor", organizationId: "org-a", role: "org_admin", facilityId: "facility-a", isActive: true }, isLoading: false }) }));
vi.mock("./useResidentAssessmentForms", () => ({ describeFunctionError: vi.fn() }));
import { useFacilitySiteReviews, useSiteDrillRotation } from "./useFacilitySiteCompliance";
import { useMedicationIntegration } from "./useMedicationIntegration";
import { useResidentAppointments, useResidentAppointmentPreparation } from "./useResidentAppointments";
import { useListResidentChangeEvents } from "./useResidentChangeEvents";
import { useListAllResidentComplianceItems } from "./useResidentComplianceItems";
import { useListResidentDocuments, useListPendingResidentDocumentDeletions } from "./useResidentDocuments";
import { useResidentRecordDestructions } from "./useResidentRecordDestructions";
import { useResidentRegulatoryActions } from "./useResidentRegulatoryActions";
import { useListResidents, useListResidentNames } from "./useResidents";
import { useResidentServiceTaskQueue, useListResidentServiceRequirements, useListServiceTaskAlerts } from "./useResidentServiceTasks";
import { useListWorkOrders } from "./useWorkOrders";

type Row = { id: string };
type Filter = [string, string, unknown];
type Call = { name: string; kind: "table" | "rpc"; args: Record<string, unknown>; range?: [number, number]; order: string[]; filters: Filter[]; signal?: AbortSignal };
type Case = { name: string; target: string; invoke: () => unknown; order?: string[]; filters?: Filter[]; args?: Record<string, unknown>; signal?: boolean; extract?: (result: unknown) => Row[]; bounded?: boolean };
const cases: Case[] = [
  { name: "site reviews RPC offset", target: "get_facility_site_reviews", invoke: () => useFacilitySiteReviews("facility-a"), args: { p_facility_id: "facility-a" } },
  { name: "site drill history", target: "inspection_events", invoke: () => useSiteDrillRotation("facility-a", "2026-09-01"), order: ["performed_date", "id"], filters: [["eq", "inspection_items.facility_id", "facility-a"], ["eq", "inspection_items.item_type", "fire_drill_program"], ["gte", "performed_date", "2026-09-01"]] },
  { name: "medication exception workspace", target: "medication_integration_exceptions", invoke: () => useMedicationIntegration("facility-a"), order: ["last_seen_at", "id"], filters: [["eq", "facility_id", "facility-a"]], extract: result => (result as { exceptions: Row[] }).exceptions },
  { name: "resident appointments", target: "resident_appointments", invoke: () => useResidentAppointments("resident-a"), order: ["starts_at", "id"], filters: [["eq", "resident_id", "resident-a"]] },
  { name: "appointment preparation", target: "resident_appointment_preparation_items", invoke: () => useResidentAppointmentPreparation(["appointment-b", "appointment-a", "appointment-a"]), order: ["item_kind", "label", "id"], filters: [["in", "appointment_id", ["appointment-a", "appointment-b"]]] },
  { name: "change events", target: "resident_change_events", invoke: () => useListResidentChangeEvents({ organizationId: "org-a", facilityId: "facility-a", residentId: "resident-a", status: "monitoring", assignedProfileId: "staff-a", category: "fall" }), order: ["follow_up_due_at", "id"], filters: [["eq", "organization_id", "org-a"], ["eq", "facility_id", "facility-a"], ["eq", "resident_id", "resident-a"], ["eq", "status", "monitoring"], ["eq", "assigned_profile_id", "staff-a"], ["eq", "category", "fall"]] },
  { name: "resident compliance report", target: "resident_compliance_items", invoke: () => useListAllResidentComplianceItems({ facilityId: "facility-a", status: ["pending", "overdue"], itemType: "assessment" }), order: ["due_date", "id"], filters: [["eq", "facility_id", "facility-a"], ["in", "status", ["pending", "overdue"]], ["eq", "item_type", "assessment"]], bounded: true },
  { name: "resident document list", target: "resident_documents", invoke: () => useListResidentDocuments("resident-a"), order: ["created_at", "id"], filters: [["eq", "resident_id", "resident-a"]], signal: true },
  { name: "pending document deletions", target: "list_pending_resident_document_deletions", invoke: () => useListPendingResidentDocumentDeletions("resident-a", true), args: { p_resident_id: "resident-a" }, signal: true },
  { name: "record destruction log", target: "list_resident_record_destructions", invoke: () => useResidentRecordDestructions("resident-a"), args: { p_resident_id: "resident-a" }, signal: true },
  { name: "resident regulatory RPC offset", target: "get_resident_regulatory_actions", invoke: () => useResidentRegulatoryActions("facility-a", "resident-a"), args: { p_facility_id: "facility-a", p_resident_id: "resident-a" } },
  { name: "resident roster", target: "residents", invoke: () => useListResidents({ facilityId: "facility-a", status: "active" }), order: ["last_name", "id"], filters: [["eq", "facility_id", "facility-a"], ["eq", "status", "active"]], bounded: true },
  { name: "resident names", target: "residents", invoke: () => useListResidentNames({ facilityId: "facility-a", status: "active" }), order: ["last_name", "id"], filters: [["eq", "facility_id", "facility-a"], ["eq", "status", "active"]], bounded: true },
  { name: "service task queue RPC range", target: "get_resident_service_task_queue", invoke: () => useResidentServiceTaskQueue({ from: "2026-09-01", through: "2026-09-30", facilityId: "facility-a", status: "scheduled" }), order: ["scheduled_start", "resident_name", "service_name", "id"], args: { p_from: "2026-09-01", p_through: "2026-09-30", p_facility_id: "facility-a", p_status: "scheduled" } },
  { name: "resident service requirements", target: "resident_service_requirements", invoke: () => useListResidentServiceRequirements({ organizationId: "org-a", facilityId: "facility-a", residentId: "resident-a", status: "active" }), order: ["service_name", "id"], filters: [["eq", "organization_id", "org-a"], ["eq", "facility_id", "facility-a"], ["eq", "resident_id", "resident-a"], ["eq", "status", "active"]] },
  { name: "service task alerts", target: "service_task_alerts", invoke: () => useListServiceTaskAlerts({ organizationId: "org-a", facilityId: "facility-a", status: "open" }), order: ["created_at", "id"], filters: [["eq", "organization_id", "org-a"], ["eq", "facility_id", "facility-a"], ["eq", "status", "open"]] },
  { name: "maintenance work orders", target: "work_orders", invoke: () => useListWorkOrders({ facilityId: "facility-a", status: "open", priority: "urgent", inspectionItemId: "inspection-a", sourceInspectionEventId: "event-a" }), order: ["created_at", "id"], filters: [["eq", "facility_id", "facility-a"], ["eq", "status", "open"], ["eq", "priority", "urgent"], ["eq", "inspection_item_id", "inspection-a"], ["eq", "source_inspection_event_id", "event-a"]] },
];
let target: string, cap: number, total: number, failAt: number | undefined, calls: Call[];
const offset = (call: Call) => call.range?.[0] ?? Number(call.args.p_offset ?? 0);
beforeEach(() => {
  vi.clearAllMocks(); cap = 2; total = 5; failAt = undefined; calls = [];
  const builder = (kind: Call["kind"], name: string, args: Record<string, unknown> = {}) => {
    const call: Call = { kind, name, args, order: [], filters: [] }; calls.push(call);
    if (calls.length > 500) throw new Error("Paging did not terminate");
    const query = {
      select: () => query,
      order: (column: string) => { call.order.push(column); return query; },
      eq: (column: string, value: unknown) => { call.filters.push(["eq", column, value]); return query; },
      in: (column: string, value: unknown) => { call.filters.push(["in", column, value]); return query; },
      gte: (column: string, value: unknown) => { call.filters.push(["gte", column, value]); return query; },
      range: (from: number, through: number) => { call.range = [from, through]; return query; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const from = offset(call), through = call.range?.[1] ?? from + 999;
        const failure = name === target && from === failAt;
        return Promise.resolve(resolve({ error: failure ? new Error("Later scoped page unavailable") : null,
          data: failure ? null : name !== target ? [] : Array.from({ length: Math.max(0, Math.min(total, through + 1, from + cap) - from) }, (_, i) => ({ id: `row-${from + i}` })),
        }));
      },
    };
    return query;
  };
  h.from.mockImplementation((name: string) => builder("table", name));
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => builder("rpc", name, args));
});
async function run(testCase: Case) {
  target = testCase.target; testCase.invoke();
  const signal = new AbortController().signal;
  const result = await h.query.mock.calls.at(-1)![0].queryFn({ signal });
  return { rows: testCase.extract ? testCase.extract(result) : result as Row[], signal, pages: calls.filter(call => call.name === target) };
}
describe("complete resident/site collections under lower PostgREST response caps", () => {
  it.each(cases)("$name continues after short pages without gaps and preserves its boundary", async testCase => {
    const { rows, signal, pages } = await run(testCase);
    expect(rows.map(row => row.id)).toEqual(["row-0", "row-1", "row-2", "row-3", "row-4"]);
    expect(pages.map(offset)).toEqual([0, 2, 4, 5]);
    for (const page of pages) {
      if (testCase.order) expect(page.order).toEqual(testCase.order);
      if (testCase.filters) expect(page.filters).toEqual(testCase.filters);
      if (testCase.args) expect(page.args).toMatchObject(testCase.args);
      if (testCase.signal) expect(page.signal).toBe(signal);
    }
  });
  it.each(cases)("$name rejects a later failure rather than presenting a complete partial collection", async testCase => {
    failAt = 2;
    await expect(run(testCase)).rejects.toThrow("Later scoped page unavailable");
    expect(calls.filter(call => call.name === testCase.target).map(offset)).toEqual([0, 2]);
  });
  it.each(cases.filter(testCase => testCase.bounded))("$name preserves its 50,000-row safety bound with an uneven server cap", async testCase => {
    cap = 777; total = 50_001;
    const { rows, pages } = await run(testCase);
    expect(rows).toHaveLength(50_000); expect(rows.at(-1)?.id).toBe("row-49999");
    expect(pages.at(-1)?.range?.[1]).toBe(49_999);
  });
});
