import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), useQuery: vi.fn(), useMutation: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

import { medicationSourceEditorStatus, useMedicationIntegration, useSaveMedicationIntegrationSource, type MedicationIntegrationWorkspace } from "./useMedicationIntegration";

interface QueryCall {
  table: string;
  limit?: number;
  range?: [number, number];
  order: string[];
  filters: Array<[string, unknown]>;
}
let calls: QueryCall[];
let exceptionCount: number;
let failOffset: number | undefined;

beforeEach(() => {
  calls = [];
  exceptionCount = 101;
  failOffset = undefined;
  mocks.useQuery.mockReset();
  mocks.useMutation.mockReset();
  mocks.invalidateQueries.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.from.mockReset().mockImplementation((table: string) => {
    const call: QueryCall = { table, order: [], filters: [] };
    calls.push(call);
    const query = {
      select: () => query,
      order: (column: string) => { call.order.push(column); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      limit: (count: number) => { call.limit = count; return query; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      then: (resolve: (result: unknown) => unknown) => {
        const [from, to] = call.range ?? [0, (call.limit ?? 1000) - 1];
        const isException = table === "medication_integration_exceptions";
        return Promise.resolve(resolve({
          data: isException && failOffset === from ? null : isException ? Array.from(
            { length: Math.max(0, Math.min(to + 1, exceptionCount) - from) },
            (_, index) => ({
              id: `exception-${from + index}`,
              status: from + index === exceptionCount - 1 ? "open" : "resolved",
              severity: from + index === exceptionCount - 1 ? "urgent" : "normal",
              last_seen_at: "2026-09-10T12:00:00Z",
            }),
          ) : [],
          error: isException && failOffset === from ? new Error("Medication exception page unavailable") : null,
        }));
      },
    };
    return query;
  });
});

describe("medication source lifecycle", () => {
  const source = { sourceId: "source-a", facilityId: "facility-a", name: "Campus eMAR", vendorName: "Vendor", externalFacilityId: "external-a", credentialId: "credential-a", freshnessThresholdMinutes: 60, status: "active" };

  it.each(["setup_required", "active", "paused", "disabled", "error"])("preserves %s when opening settings instead of activating a connection", (status) => {
    expect(medicationSourceEditorStatus({ status })).toBe(status);
  });

  it("updates the existing source in its facility and refreshes that workspace", async () => {
    useSaveMedicationIntegrationSource();
    const mutation = mocks.useMutation.mock.calls[0][0];
    await mutation.mutationFn(source);
    expect(mocks.rpc).toHaveBeenCalledWith("save_medication_integration_source", expect.objectContaining({
      p_source_id: "source-a", p_facility_id: "facility-a", p_credential_id: "credential-a", p_status: "active",
    }));
    mutation.onSuccess(null, source);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["medication-integration", "facility-a"] });
  });

  it.each(["paused", "disabled"])("allows stopping imports with %s without creating a duplicate source", async (status) => {
    useSaveMedicationIntegrationSource();
    await mocks.useMutation.mock.calls[0][0].mutationFn({ ...source, status });
    expect(mocks.rpc).toHaveBeenCalledWith("save_medication_integration_source", expect.objectContaining({ p_source_id: "source-a", p_status: status }));
  });

  it.each([0, 4, 1441, 5.5, NaN, Infinity])("rejects invalid freshness %s before calling the backend", async (freshnessThresholdMinutes) => {
    useSaveMedicationIntegrationSource();
    await expect(mocks.useMutation.mock.calls[0][0].mutationFn({ ...source, freshnessThresholdMinutes })).rejects.toThrow("whole number");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a credential for activation but permits saving an unbound setup", async () => {
    useSaveMedicationIntegrationSource();
    const mutation = mocks.useMutation.mock.calls[0][0];
    await expect(mutation.mutationFn({ ...source, credentialId: undefined })).rejects.toThrow("requires");
    expect(mocks.rpc).not.toHaveBeenCalled();
    await mutation.mutationFn({ ...source, credentialId: undefined, status: "setup_required" });
    expect(mocks.rpc).toHaveBeenCalledWith("save_medication_integration_source", expect.objectContaining({ p_source_id: "source-a", p_status: "setup_required" }));
  });
});

const queryFn = () => (mocks.useQuery.mock.calls.at(-1)![0] as {
  queryFn: () => Promise<MedicationIntegrationWorkspace>;
}).queryFn();

describe("medication integration exception visibility", () => {
  it("keeps an unresolved urgent exception visible after 100 newer resolved ones", async () => {
    useMedicationIntegration("facility-a");
    const workspace = await queryFn();
    expect(workspace.exceptions.filter((row) => !["resolved", "dismissed"].includes(row.status)))
      .toEqual([expect.objectContaining({ id: "exception-100", status: "open", severity: "urgent" })]);
    expect(workspace.exceptions).toHaveLength(101);
  });

  it("pages beyond the API cap with stable ordering and the same facility scope", async () => {
    exceptionCount = 1001;
    useMedicationIntegration("facility-a");
    expect((await queryFn()).exceptions).toHaveLength(1001);
    const exceptionCalls = calls.filter((call) => call.table === "medication_integration_exceptions");
    expect(exceptionCalls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
    for (const call of exceptionCalls) {
      expect(call.order).toEqual(["last_seen_at", "id"]);
      expect(call.filters).toEqual([["facility_id", "facility-a"]]);
    }
  });

  it("shows a query error instead of a partial all-resolved list when the next page fails", async () => {
    exceptionCount = 1001;
    failOffset = 1000;
    useMedicationIntegration("facility-a");
    const outcome = await queryFn().then(() => "success", (error: Error) => error.message);
    expect(outcome).toBe("Medication exception page unavailable");
  });
});
