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
  orders: Array<[string, boolean]>;
  columns?: string;
  selectOptions?: { count?: string; head?: boolean };
  range?: [number, number];
  limit?: number;
  afterId?: string;
  signal?: AbortSignal;
  parameters?: Record<string, unknown>;
}

let rows: Row[];
let mappings: Array<{ id: string; facility_id: string; status: string; mapped_at: string }>;
let calls: Call[];
let failAfterId: string | undefined;
let failHistory: boolean;
let failMappings: boolean;
let missingMappingCount: boolean;
const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const row = (index: number, status = "open", overrides: Partial<Row> = {}): Row => ({
  id: id(index), facility_id: "facility-a", status, severity: "warning",
  last_seen_at: "2026-09-15T12:00:00Z", updated_at: "2026-09-15T12:00:00Z", ...overrides,
});

function response(call: Call) {
  if (call.kind === "rpc") {
    return { data: { requestTotal: 7, requestActiveTotal: 4, administrationTotal: 12, lastRequestAt: null, lastAdministrationAt: null, residents: [] }, error: null };
  }
  if (call.name === "fhir_patient_mappings") {
    if (failMappings) return { data: null, count: null, error: new Error("Mapping count unavailable") };
    const selected = mappings.filter((entry) => call.filters.every(([column, value]) => entry[column as keyof typeof entry] === value));
    return { data: call.selectOptions?.head ? null : selected.slice(0, call.limit ?? 1000), count: call.selectOptions?.count === "exact" && !missingMappingCount ? selected.length : null, error: null };
  }
  if (call.name !== "fhir_integration_exceptions") return { data: [], error: null };
  const statuses = call.filters.find(([column]) => column === "status")?.[1] as string[] | undefined;
  const active = statuses?.includes("open");
  if (active && failAfterId !== undefined && call.afterId === failAfterId) return { data: null, error: new Error("Active exception page unavailable") };
  if (!active && failHistory) return { data: null, error: new Error("Recent history unavailable") };
  let selected = rows.filter((entry) => call.filters.every(([column, value]) => {
    const actual = entry[column as keyof Row];
    return Array.isArray(value) ? value.includes(actual) : value === actual;
  }));
  if (call.afterId) selected = selected.filter((entry) => entry.id > call.afterId!);
  selected.sort((left, right) => {
    for (const [column, ascending] of call.orders) {
      const compared = String(left[column as keyof Row]).localeCompare(String(right[column as keyof Row]));
      if (compared) return ascending ? compared : -compared;
    }
    return 0;
  });
  const [from, to] = call.range ?? [0, (call.limit ?? 1000) - 1];
  return { data: selected.slice(from, to + 1), error: null };
}

function builder(call: Call) {
  calls.push(call);
  const query = {
    select: (columns: string, options?: Call["selectOptions"]) => { call.columns = columns; call.selectOptions = options; return query; },
    eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
    in: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
    gt: (_column: string, value: string) => { call.afterId = value; return query; },
    order: (column: string, options?: { ascending?: boolean }) => { call.orders.push([column, options?.ascending !== false]); return query; },
    range: (from: number, to: number) => { call.range = [from, to]; return query; },
    limit: (limit: number) => { call.limit = limit; return query; },
    abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
    then: (resolve: (value: ReturnType<typeof response>) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(() => response(call)).then(resolve, reject),
  };
  return query;
}

beforeEach(() => {
  rows = []; mappings = []; calls = []; failAfterId = undefined; failHistory = false; failMappings = false; missingMappingCount = false;
  mocks.from.mockReset(); mocks.rpc.mockReset(); mocks.useQuery.mockReset();
  mocks.from.mockImplementation((name: string) => builder({ name, kind: "table", filters: [], orders: [] }));
  mocks.rpc.mockImplementation((name: string, parameters: Record<string, unknown>) => builder({ name, parameters, kind: "rpc", filters: [], orders: [] }));
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
function activeCalls() {
  return calls.filter((call) => call.filters.some(([column, value]) => column === "status" && Array.isArray(value) && value.includes("open")));
}

describe("FHIR exception work queue completeness", () => {
  it("keeps an older urgent open exception ahead of 100 recently refreshed resolved rows", async () => {
    rows = Array.from({ length: 100 }, (_, index) => row(index + 1, "resolved"));
    rows.push(row(1001, "open", { severity: "urgent", last_seen_at: "2026-08-01T00:00:00Z" }));
    const result = await fetchWorkspace();
    expect(result.mappedPatientCount).toBe(0);
    expect(result.exceptions).toHaveLength(101);
    expect(result.exceptions[0]).toMatchObject({ id: id(1001), status: "open", severity: "urgent" });
    expect(result.exceptions.filter((entry) => ["open", "acknowledged"].includes(entry.status))).toHaveLength(1);
  });

  it("reads every active page beyond 1000 and appends only the latest 100 completed entries", async () => {
    rows = Array.from({ length: 1005 }, (_, index) => row(index + 1, index % 2 ? "acknowledged" : "open"));
    rows.push(...Array.from({ length: 110 }, (_, index) => row(2001 + index, index % 2 ? "resolved" : "dismissed")));
    const result = await fetchWorkspace();
    expect(result.exceptions).toHaveLength(1105);
    expect(result.exceptions.filter((entry) => ["open", "acknowledged"].includes(entry.status))).toHaveLength(1005);
    expect(new Set(result.exceptions.map((entry) => entry.id)).size).toBe(1105);
    expect(activeCalls().map((call) => [call.afterId, call.range, call.orders])).toEqual([
      [undefined, [0, 999], [["id", true]]],
      [id(1000), [0, 999], [["id", true]]],
    ]);
    expect(result.exceptions[1004].id).toBe(id(1005));
    expect(result.exceptions[1005].id).toBe(id(2001));
  });

  it("checks for another active page when the first page exactly reaches the API cap", async () => {
    rows = Array.from({ length: 1000 }, (_, index) => row(index + 1));
    expect((await fetchWorkspace()).exceptions).toHaveLength(1000);
    expect(activeCalls()).toHaveLength(2);
  });

  it("rejects the workspace when a later active page fails instead of publishing incomplete counts", async () => {
    rows = Array.from({ length: 1005 }, (_, index) => row(index + 1));
    failAfterId = id(1000);
    await expect(fetchWorkspace()).rejects.toThrow("Active exception page unavailable");
  });

  it("retains errors from the separately bounded completed history", async () => {
    rows = [row(1)];
    failHistory = true;
    await expect(fetchWorkspace()).rejects.toThrow("Recent history unavailable");
  });

  it("scopes every request to the facility, forwards cancellation, and reads only metadata activity", async () => {
    rows = [row(1), row(2, "open", { facility_id: "facility-b" }), row(3, "resolved", { facility_id: "facility-b" })];
    const signal = new AbortController().signal;
    const result = await fetchWorkspace(signal);
    expect(result.exceptions.map((entry) => entry.id)).toEqual([id(1)]);
    expect(result.activity.administrationTotal).toBe(12);
    for (const call of calls) {
      expect(call.signal).toBe(signal);
      if (call.kind === "table") expect(call.filters).toContainEqual(["facility_id", "facility-a"]);
    }
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_facility_fhir_ingestion_activity", { p_facility_id: "facility-a" });
    expect(new Set(calls.filter((call) => call.kind === "table").map((call) => call.name))).toEqual(new Set([
      "fhir_integration_sources", "fhir_patient_mappings", "fhir_integration_exceptions",
    ]));
  });

  it("deduplicates an exception resolved between reads using its newest observed disposition", async () => {
    rows = [
      row(1, "open", { updated_at: "2026-09-15T11:00:00Z" }),
      row(1, "resolved", { updated_at: "2026-09-15T12:00:00Z" }),
      row(2, "acknowledged"),
    ];
    const result = await fetchWorkspace();
    expect(result.exceptions.map((entry) => [entry.id, entry.status])).toEqual([[id(2), "acknowledged"], [id(1), "resolved"]]);
  });

  it("retains newer reopened evidence and treats tied timestamps conservatively", async () => {
    rows = [row(1, "open"), row(1, "resolved", { updated_at: "2026-09-15T11:00:00Z" }), row(2, "acknowledged"), row(2, "dismissed")];
    expect((await fetchWorkspace()).exceptions.map((entry) => entry.status)).toEqual(["open", "acknowledged"]);
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
    expect(request.limit).toBeUndefined();
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
