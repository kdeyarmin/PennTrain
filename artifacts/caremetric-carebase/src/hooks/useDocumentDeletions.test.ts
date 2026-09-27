import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), client: null as unknown, rpc: vi.fn(), remove: vi.fn(),
  user: { id: "actor", organizationId: "org", role: "org_admin", facilityId: "assigned" } as Record<string, unknown> | null }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(), useQuery: h.query, useMutation: h.mutation, useQueryClient: () => h.client }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, storage: { from: () => ({ remove: h.remove }) } } }));
import { usePendingDocumentDeletions, useRetryDocumentDeletion } from "./useDocumentDeletions";
import { useDeleteDocument } from "./useDocuments";
import { useDeleteMaintenanceDocument } from "./useWorkOrders";
import { useDeleteCredentialDocument } from "./useCredentialDocuments";
import { useDeleteIncidentDocument } from "./useIncidentDocuments";
import { useDeleteViolationDocument } from "./useViolationDocuments";
import { useRemoveComplianceEvidence } from "./useComplianceRequirements";

let client: QueryClient;
const options = () => h.query.mock.calls.at(-1)![0];
const mutation = () => h.mutation.mock.calls.at(-1)![0];
const receipt = { document_kind: "training", document_id: "doc", facility_id: "facility", storage_bucket: "signin-sheets", storage_path: "server-path", file_name: "roster.pdf", requested_at: "2026-09-27T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } }); h.client = client;
  h.user = { id: "actor", organizationId: "org", role: "org_admin", facilityId: "assigned" };
  h.remove.mockResolvedValue({ data: [], error: null });
});
afterEach(() => client.clear());

describe("pending deletion collection", () => {
  it("loads every scoped receipt despite a smaller server row cap and passes the cancellation signal", async () => {
    const ranges: number[][] = []; const signals: AbortSignal[] = [];
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...receipt, document_id: `doc-${i}` }));
    h.rpc.mockImplementation(() => ({ range: (from: number, to: number) => { ranges.push([from, to]); return {
      abortSignal: async (signal: AbortSignal) => { signals.push(signal); return { data: rows.slice(from, from + 2), error: null }; },
    }; } }));
    usePendingDocumentDeletions("training", "facility");
    expect(await client.fetchQuery(options())).toEqual(rows);
    expect(ranges).toEqual([[0, 499], [2, 501], [4, 503], [5, 504]]);
    expect(new Set(signals).size).toBe(1); expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(h.rpc.mock.calls.every(([name, args]) => name === "list_pending_document_deletions" && args.p_document_kind === "training" && args.p_facility_id === "facility")).toBe(true);
  });
  it("rejects a later failed page without publishing a partial cleanup list", async () => {
    h.rpc.mockImplementation(() => ({ range: (from: number) => ({ abortSignal: async () => from === 0
      ? { data: [receipt], error: null } : { data: null, error: new Error("Second page failed") } }) }));
    usePendingDocumentDeletions(); const config = options();
    await expect(client.fetchQuery(config)).rejects.toThrow("Second page failed");
    expect(client.getQueryData(config.queryKey)).toBeUndefined();
  });
  it("aborts a pending scoped read instead of caching results after cancellation", async () => {
    let signal!: AbortSignal;
    h.rpc.mockImplementation(() => ({ range: () => ({ abortSignal: (value: AbortSignal) => {
      signal = value; return new Promise((_, reject) => value.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
    } }) }));
    usePendingDocumentDeletions("credential", "facility"); const config = options();
    const result = client.fetchQuery(config); const rejected = expect(result).rejects.toBeDefined();
    await client.cancelQueries({ queryKey: config.queryKey }); await rejected;
    expect(signal.aborted).toBe(true); expect(client.getQueryData(config.queryKey)).toBeUndefined(); expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it("isolates actor, organization, role, assigned facility and explicit filter keys", () => {
    const keys = new Set<string>(); const capture = () => { usePendingDocumentDeletions("training", "filter-a"); keys.add(JSON.stringify(options().queryKey)); };
    capture();
    for (const [field, value] of [["id", "other"], ["organizationId", "other-org"], ["role", "facility_manager"], ["facilityId", "other-facility"]]) { h.user = { ...h.user, [field]: value }; capture(); }
    usePendingDocumentDeletions("credential", "filter-a"); keys.add(JSON.stringify(options().queryKey));
    usePendingDocumentDeletions("credential", "filter-b"); keys.add(JSON.stringify(options().queryKey));
    expect(keys.size).toBe(7); h.user = null; usePendingDocumentDeletions(); expect(options().enabled).toBe(false);
  });
  it.each([true, false])("invalidates every pending scope after a retry settles (confirmed=%s)", async confirmed => {
    h.rpc.mockResolvedValue({ data: confirmed, error: null });
    client.setQueryData(["document_deletions", "actor-a"], [receipt]); client.setQueryData(["document_deletions", "actor-b"], []); client.setQueryData(["other"], "keep");
    useRetryDocumentDeletion(); const config = mutation();
    const run = client.getMutationCache().build(client, config).execute(receipt);
    if (confirmed) await run; else await expect(run).rejects.toThrow("still pending");
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["confirm_document_deletion"]);
    expect(client.getQueryState(["document_deletions", "actor-a"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["document_deletions", "actor-b"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["other"])?.isInvalidated).toBe(false);
  });
});

const deleteHooks = [
  ["training", useDeleteDocument, "documents"], ["maintenance", useDeleteMaintenanceDocument, "maintenance_documents"],
  ["credential", useDeleteCredentialDocument, "credential_documents"], ["incident", useDeleteIncidentDocument, "incident_documents"],
  ["violation", useDeleteViolationDocument, "violation_documents"], ["compliance", useRemoveComplianceEvidence, "compliance-requirement"],
] as const;
describe.each(deleteHooks)("%s document deletion integration", (kind, hook, cacheKey) => {
  it.each([true, false])("uses the authorized receipt and refreshes document/pending caches after settlement (confirmed=%s)", async confirmed => {
    const saved = { ...receipt, document_kind: kind };
    h.rpc.mockImplementation(async name => ({ data: name === "begin_document_deletion" ? [saved] : confirmed, error: null }));
    client.setQueryData([cacheKey], ["old document"]); client.setQueryData(["document_deletions"], []);
    hook(); const config = mutation();
    const run = client.getMutationCache().build(client, config).execute({ id: "doc", storage_bucket: "stale-bucket", storage_path: "stale-path" });
    if (confirmed) await run; else await expect(run).rejects.toThrow("still pending");
    expect(h.rpc.mock.calls).toEqual([["begin_document_deletion", { p_document_kind: kind, p_document_id: "doc" }], ["confirm_document_deletion", { p_document_kind: kind, p_document_id: "doc" }]]);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith(["server-path"]);
    expect(client.getQueryState([cacheKey])?.isInvalidated).toBe(true); expect(client.getQueryState(["document_deletions"])?.isInvalidated).toBe(true);
  });
});
