import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
const h = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), employee: { id: "employee", facility_id: "home", status: "active" } as object | null,
  employeeError: null as unknown, pages: [] as { data: { facility_id: string }[] | null; error: unknown }[],
  filters: [] as unknown[][], selections: [] as unknown[][], ranges: [] as unknown[][],
  signals: [] as AbortSignal[],
}));
vi.mock("./supabase", () => ({ supabase: {
  rpc: (...args: unknown[]) => {
    const request = h.rpc(...args);
    request.abortSignal = (signal: AbortSignal) => { h.signals.push(signal); return request; };
    return request;
  },
  from: h.from,
} }));
import { canReadOfflineObservationResident, hasAssignedFacilityScope, loadSessionFacilityScope, loadSessionPrimaryFacility } from "./sessionFacilityScope";
const employee = { id: "profile", organization_id: "org", role: "employee" };
beforeEach(() => {
  vi.clearAllMocks(); h.filters = []; h.selections = []; h.ranges = []; h.signals = [];
  h.employee = { id: "employee", facility_id: "home", status: "active" }; h.employeeError = null;
  h.pages = [{ data: [{ facility_id: "second" }, { facility_id: "home" }], error: null }];
  h.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  h.from.mockImplementation((table: string) => {
    const query = {
      select: (columns: string) => { h.selections.push([table, columns]); return query; },
      eq: (column: string, value: unknown) => { h.filters.push([table, column, value]); return query; },
      order: (column: string) => { h.filters.push([table, "order", column]); return query; },
      maybeSingle: async () => ({ data: h.employee, error: h.employeeError }),
      range: async (from: number, to: number) => { h.ranges.push([table, from, to]); return h.pages.shift() ?? { data: [], error: null }; },
    };
    return query;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("authoritative session facility scope", () => {
  it("preserves local observations without network requests when the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(canReadOfflineObservationResident("resident")).resolves.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("bounds a stalled authorization read and cannot start a late clinical request after the deadline", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    h.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const result = canReadOfflineObservationResident("resident");
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBeNull();
    expect(h.signals[0].aborted).toBe(true);
    finish({ data: true, error: null }); await Promise.resolve(); await Promise.resolve();
    expect(h.rpc).toHaveBeenCalledOnce();
  });
  it("uses the remaining batch time and skips requests when that time is exhausted", async () => {
    vi.useFakeTimers();
    h.rpc.mockImplementationOnce(() => new Promise(() => {}));
    const result = canReadOfflineObservationResident("resident", 750);
    await vi.advanceTimersByTimeAsync(750);
    await expect(result).resolves.toBeNull();
    expect(h.signals[0].aborted).toBe(true);
    await expect(canReadOfflineObservationResident("next-resident", 0)).resolves.toBeNull();
    expect(h.rpc).toHaveBeenCalledOnce();
  });
  it("authorizes retained observations through the current resident access contract with an honest audit reason", async () => {
    await expect(canReadOfflineObservationResident("resident")).resolves.toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("log_clinical_access", expect.objectContaining({ p_resident_id: "resident", p_access_kind: "view_domain", p_clinical_domain: "observations" }));
  });
  it("treats only the exact unlocked resident-scope denial as confirmed observation revocation", async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Clinical access is outside caller scope" } });
    await expect(canReadOfflineObservationResident("resident")).resolves.toBe(false);
  });
  it.each([
    { code: "42501", message: "SMS verification is required", hint: "mfa_required" },
    { code: "P0002", message: "Resident not found" },
    { message: "Network unavailable" },
  ])("preserves legacy readings for an unknown access result %j", async error => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error });
    await expect(canReadOfflineObservationResident("resident")).resolves.toBeNull();
  });
  it("does not classify a denial during a lock transition as revoked resident access", async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Clinical access is outside caller scope" } })
      .mockResolvedValueOnce({ data: false, error: null });
    await expect(canReadOfflineObservationResident("resident")).resolves.toBeNull();
  });
  it("unions and sorts the active employee's primary and secondary facilities with tenant/employee filters", async () => {
    await expect(loadSessionFacilityScope(employee)).resolves.toEqual(["home", "second"]);
    expect(h.filters).toEqual(expect.arrayContaining([
      ["employees", "profile_id", "profile"], ["employees", "organization_id", "org"],
      ["employee_facility_assignments", "employee_id", "employee"],
      ["employee_facility_assignments", "organization_id", "org"],
      ["employee_facility_assignments", "order", "facility_id"],
    ]));
    expect(h.rpc).toHaveBeenCalledWith("current_session_unlocked");
  });
  it.each(["inactive", "terminated"])("resolves no clinical facilities for an %s employee", async status => {
    h.employee = { id: "employee", facility_id: "home", status };
    await expect(loadSessionFacilityScope(employee)).resolves.toEqual([]);
    expect(h.from).not.toHaveBeenCalledWith("employee_facility_assignments");
  });
  it("resolves no employee clinical facilities when the employee row is absent", async () => {
    h.employee = null; await expect(loadSessionFacilityScope(employee)).resolves.toEqual([]);
  });
  it.each(["facility_manager", "trainer"])("uses profile assignments and active same-tenant facilities for %s", async role => {
    await expect(loadSessionFacilityScope({ ...employee, role })).resolves.toEqual(["home", "second"]);
    expect(h.from).not.toHaveBeenCalledWith("employees");
    expect(h.selections).toContainEqual(["facility_assignments", "facility_id, facilities!inner(id)"]);
    expect(h.filters).toEqual(expect.arrayContaining([
      ["facility_assignments", "profile_id", "profile"],
      ["facility_assignments", "facilities.organization_id", "org"],
      ["facility_assignments", "facilities.is_active", true],
    ]));
  });
  it("treats an idle/SMS gate as unknown before reading assignment rows", async () => {
    h.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(loadSessionFacilityScope(employee)).resolves.toBeNull(); expect(h.from).not.toHaveBeenCalled();
  });
  it("does not mistake an idle lock established during the read for revoked scope", async () => {
    h.employee = null; h.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    await expect(loadSessionFacilityScope(employee)).resolves.toBeNull();
  });
  it("throws a transient or MFA refusal rather than returning an authoritative empty set", async () => {
    const error = { code: "42501", hint: "mfa_required" }; h.rpc.mockResolvedValueOnce({ data: null, error });
    await expect(loadSessionFacilityScope(employee)).rejects.toBe(error);
    h.employeeError = new Error("Network error");
    await expect(loadSessionFacilityScope(employee)).rejects.toBe(h.employeeError);
  });
  it("reads every assignment page and fails instead of returning a partial scope", async () => {
    h.pages = [{ data: Array.from({ length: 1000 }, (_, i) => ({ facility_id: `facility-${i}` })), error: null }, { data: [{ facility_id: "last" }], error: null }];
    const scope = await loadSessionFacilityScope(employee); expect(scope).toHaveLength(1002); expect(scope).toContain("last");
    expect(h.ranges).toEqual([["employee_facility_assignments", 0, 999], ["employee_facility_assignments", 1000, 1999], ["employee_facility_assignments", 1001, 2000]]);
    const error = new Error("Second page failed");
    h.pages = [{ data: Array.from({ length: 1000 }, () => ({ facility_id: "same" })), error: null }, { data: null, error }];
    await expect(loadSessionFacilityScope(employee)).rejects.toBe(error);
  });
  it("continues at the actual offset when the API caps responses below the requested range", async () => {
    h.pages = [
      { data: [{ facility_id: "a" }, { facility_id: "b" }], error: null },
      { data: [{ facility_id: "c" }], error: null },
      { data: [], error: null },
    ];
    await expect(loadSessionFacilityScope(employee)).resolves.toEqual(["a", "b", "c", "home"]);
    expect(h.ranges).toEqual([["employee_facility_assignments", 0, 999], ["employee_facility_assignments", 2, 1001], ["employee_facility_assignments", 3, 1002]]);
  });
  it("keeps public primary-facility semantics for an unlocked employee or an absent employee row", async () => {
    await expect(loadSessionPrimaryFacility("profile")).resolves.toBe("home");
    h.employee = null; await expect(loadSessionPrimaryFacility("profile")).resolves.toBeNull();
  });
  it.each(["before", "during"])("preserves the cached primary facility when a temporary lock occurs %s its read", async when => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["profile-facility", "profile"];
    client.setQueryData(queryKey, "home");
    if (when === "during") h.rpc.mockResolvedValueOnce({ data: true, error: null });
    h.rpc.mockResolvedValueOnce({ data: false, error: null }); h.employee = null;
    await expect(client.fetchQuery({ queryKey, queryFn: () => loadSessionPrimaryFacility("profile") })).rejects.toThrow("session is locked");
    expect(client.getQueryData(queryKey)).toBe("home"); client.clear();
  });
  it("retains the cached primary on an SMS-MFA refusal too", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["profile-facility", "profile"];
    client.setQueryData(queryKey, "home");
    const error = { code: "42501", hint: "mfa_required" }; h.rpc.mockResolvedValueOnce({ data: null, error });
    await expect(client.fetchQuery({ queryKey, queryFn: () => loadSessionPrimaryFacility("profile") })).rejects.toBe(error);
    expect(client.getQueryData(queryKey)).toBe("home"); client.clear();
  });
  it.each(["org_admin", "auditor", "platform_admin"])("does not narrow organization-wide %s roles to assignments", async role => {
    expect(hasAssignedFacilityScope(role)).toBe(false);
    await expect(loadSessionFacilityScope({ ...employee, role })).resolves.toBeNull(); expect(h.from).not.toHaveBeenCalled();
  });
});
