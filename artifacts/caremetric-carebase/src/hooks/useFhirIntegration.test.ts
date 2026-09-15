import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useFhirIntegration, type FhirException, type FhirIntegrationWorkspace } from "./useFhirIntegration";

type Row = Pick<FhirException, "id" | "facility_id" | "status" | "severity" | "last_seen_at" | "updated_at">;
interface Call {
  name: string;
  kind: "table" | "rpc";
  filters: Array<[string, unknown]>;
  columns?: string;
  selectOptions?: { count?: string; head?: boolean };
  signal?: AbortSignal;
  parameters?: Record<string, unknown>;
}

let queueData: unknown;
let queueError: Error | null;
let activityError: Error | null;
let mappings: Array<{ id: string; facility_id: string; status: string; mapped_at: string }>;
let calls: Call[];
let failMappings: boolean;
let missingMappingCount: boolean;
const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const row = (index: number, status = "open", overrides: Partial<Row> = {}): Row => ({
  id: id(index), facility_id: "facility-a", status, severity: "warning",
  last_seen_at: "2026-09-15T12:00:00Z", updated_at: "2026-09-15T12:00:00Z", ...overrides,
});

function response(call: Call) {
  if (call.name === "get_fhir_integration_review_queue") return { data: queueData, error: queueError };
  if (call.name === "get_facility_fhir_ingestion_activity") {
    return { data: { requestTotal: 7, requestActiveTotal: 4, administrationTotal: 12, lastRequestAt: null, lastAdministrationAt: null, residents: [] }, error: activityError };
  }
  if (call.name === "fhir_patient_mappings") {
    if (failMappings) return { data: null, count: null, error: new Error("Mapping count unavailable") };
    const selected = mappings.filter((entry) => call.filters.every(([column, value]) => entry[column as keyof typeof entry] === value));
    return { data: call.selectOptions?.head ? null : selected, count: call.selectOptions?.count === "exact" && !missingMappingCount ? selected.length : null, error: null };
  }
  if (call.name === "fhir_integration_sources") return { data: [], error: null };
  throw new Error(`Unexpected dashboard read: ${call.name}`);
}

function builder(call: Call) {
  calls.push(call);
  const query = {
    select: (columns: string, options?: Call["selectOptions"]) => { call.columns = columns; call.selectOptions = options; return query; },
    eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
    order: () => query,
    abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
    then: (resolve: (value: ReturnType<typeof response>) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(() => response(call)).then(resolve, reject),
  };
  return query;
}

beforeEach(() => {
  queueData = []; queueError = null; activityError = null;
  mappings = []; calls = []; failMappings = false; missingMappingCount = false;
  mocks.from.mockReset(); mocks.rpc.mockReset(); mocks.useQuery.mockReset();
  mocks.from.mockImplementation((name: string) => builder({ name, kind: "table", filters: [] }));
  mocks.rpc.mockImplementation((name: string, parameters: Record<string, unknown>) => builder({ name, parameters, kind: "rpc", filters: [] }));
});

function querySpec() {
  return mocks.useQuery.mock.calls.at(-1)![0] as {
    enabled: boolean;
    queryFn: (context: { signal: AbortSignal }) => Promise<FhirIntegrationWorkspace>;
  };
}
function fetchWorkspace(signal = new AbortController().signal) {
  useFhirIntegration("facility-a");
  return querySpec().queryFn({ signal });
}
function reviewCalls() {
  return calls.filter((call) => call.name === "get_fhir_integration_review_queue");
}

describe("FHIR exception work queue completeness", () => {
  it("preserves an older urgent open exception ahead of 100 recently refreshed resolved rows", async () => {
    queueData = [
      row(1001, "open", { severity: "urgent", last_seen_at: "2026-08-01T00:00:00Z" }),
      ...Array.from({ length: 100 }, (_, index) => row(index + 1, "resolved")),
    ];
    const result = await fetchWorkspace();
    expect(result.mappedPatientCount).toBe(0);
    expect(result.exceptions).toEqual(queueData);
    expect(result.exceptions).toHaveLength(101);
    expect(result.exceptions[0]).toMatchObject({ id: id(1001), status: "open", severity: "urgent" });
  });

  it("keeps every active entry beyond 1000 and the bounded history from one RPC response", async () => {
    queueData = [
      ...Array.from({ length: 1005 }, (_, index) => row(index + 1, index % 2 ? "acknowledged" : "open")),
      ...Array.from({ length: 100 }, (_, index) => row(2001 + index, index % 2 ? "resolved" : "dismissed")),
    ];
    const result = await fetchWorkspace();
    expect(result.exceptions).toHaveLength(1105);
    expect(result.exceptions.filter((entry) => ["open", "acknowledged"].includes(entry.status))).toHaveLength(1005);
    expect(result.exceptions).toEqual(queueData);
    expect(reviewCalls()).toHaveLength(1);
    expect(mocks.from).not.toHaveBeenCalledWith("fhir_integration_exceptions");
  });

  it("uses the snapshot disposition without issuing independently timed status reads", async () => {
    // The RPC owns snapshot consistency. This caller regression ensures the resolved row
    // comes from that response, never a second status-filtered request.
    queueData = [row(1, "resolved")];
    const result = await fetchWorkspace();
    expect(result.exceptions).toEqual([row(1, "resolved")]);
    expect(reviewCalls()).toHaveLength(1);
    expect(mocks.from).not.toHaveBeenCalledWith("fhir_integration_exceptions");
  });

  it("rejects the workspace when the review queue fails instead of publishing incomplete counts", async () => {
    queueError = new Error("Review queue unavailable");
    await expect(fetchWorkspace()).rejects.toThrow("Review queue unavailable");
  });

  it.each([null, undefined, {}, "[]"])("rejects missing or nonarray review queue data (%j)", async (data) => {
    queueData = data;
    await expect(fetchWorkspace()).rejects.toThrow("FHIR exception queue is unavailable");
  });

  it("accepts an authoritative empty JSON array", async () => {
    expect((await fetchWorkspace()).exceptions).toEqual([]);
  });

  it("scopes every request to the facility, forwards cancellation, and reads only metadata activity", async () => {
    queueData = [row(1)];
    const signal = new AbortController().signal;
    const result = await fetchWorkspace(signal);
    expect(result.activity.administrationTotal).toBe(12);
    for (const call of calls) {
      expect(call.signal).toBe(signal);
      if (call.kind === "table") expect(call.filters).toContainEqual(["facility_id", "facility-a"]);
      else expect(call.parameters).toEqual({ p_facility_id: "facility-a" });
    }
    expect(mocks.rpc.mock.calls).toEqual([
      ["get_facility_fhir_ingestion_activity", { p_facility_id: "facility-a" }],
      ["get_fhir_integration_review_queue", { p_facility_id: "facility-a" }],
    ]);
    expect(new Set(calls.filter((call) => call.kind === "table").map((call) => call.name))).toEqual(new Set([
      "fhir_integration_sources", "fhir_patient_mappings",
    ]));
  });

  it("retains errors from the metadata activity RPC", async () => {
    activityError = new Error("Activity unavailable");
    await expect(fetchWorkspace()).rejects.toThrow("Activity unavailable");
  });

  it("does not request an unscoped workspace before the facility resolves", () => {
    useFhirIntegration();
    expect(querySpec().enabled).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("counts all active mappings beyond 200 without downloading patient identifiers or inactive history", async () => {
    mappings = [
      ...Array.from({ length: 305 }, (_, index) => ({ id: id(index), facility_id: "facility-a", status: "active", mapped_at: "2026-08-01T00:00:00Z" })),
      ...Array.from({ length: 250 }, (_, index) => ({ id: id(1000 + index), facility_id: "facility-a", status: "inactive", mapped_at: "2026-09-15T00:00:00Z" })),
      { id: id(2000), facility_id: "facility-b", status: "active", mapped_at: "2026-09-15T00:00:00Z" },
    ];
    const result = await fetchWorkspace();
    expect(result.mappedPatientCount).toBe(305);
    expect(result).not.toHaveProperty("mappings");
    const request = calls.find((call) => call.name === "fhir_patient_mappings")!;
    expect(request.selectOptions).toEqual({ count: "exact", head: true });
    expect(request.columns).toBe("id");
    expect(request.filters).toContainEqual(["status", "active"]);
  });

  it("does not turn a failed mapping count into a zero-patient dashboard", async () => {
    failMappings = true;
    await expect(fetchWorkspace()).rejects.toThrow("Mapping count unavailable");
  });

  it("rejects an absent exact count even when the response reports no error", async () => {
    missingMappingCount = true;
    await expect(fetchWorkspace()).rejects.toThrow("Mapped patient count is unavailable");
  });
});
