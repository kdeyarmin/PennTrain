import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), useQuery: vi.fn(), from: vi.fn(), remove: vi.fn(), rpc: vi.fn(), invalidateQueries: vi.fn() }));
const identity = vi.hoisted(() => ({ user: { id: "actor", organizationId: "org", role: "org_admin", facilityId: null, isActive: true } as Record<string, unknown> | null, isLoading: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => identity }));
vi.mock("@tanstack/react-query", () => ({ useMutation: mocks.useMutation, useQuery: mocks.useQuery, useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } } }));
vi.mock("./useResidentAssessmentForms", () => ({ describeFunctionError: vi.fn() }));
import { useDeleteResidentDocument, useListPendingResidentDocumentDeletions, useRetryResidentDocumentDeletion, type ResidentDocument } from "./useResidentDocuments";

const doc = { id: "doc", resident_id: "resident", storage_bucket: "resident-documents", storage_path: "stale-client-path" } as ResidentDocument;
const receipt = { document_id: "doc", resident_id: "resident", storage_bucket: "resident-documents", storage_path: "server-path", file_name: "file.pdf", requested_at: "2026-09-15T00:00:00Z" };
let metadata: { data: unknown; error: unknown };
const mutation = () => mocks.useMutation.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.clearAllMocks();
  identity.user = { id: "actor", organizationId: "org", role: "org_admin", facilityId: null, isActive: true };
  identity.isLoading = false;
  metadata = { data: [receipt], error: null };
  mocks.remove.mockResolvedValue({ data: [{ name: "server-path" }], error: null });
  mocks.rpc.mockImplementation(async (name: string) => name === "begin_resident_document_deletion" ? metadata : { data: true, error: null });
});

describe("resident document deletion preserves retained evidence", () => {
  it.each(["foreign key violation", "permission denied", "network unavailable"])("never removes bytes after %s", async (message) => {
    metadata = { data: null, error: new Error(message) };
    useDeleteResidentDocument();
    await expect(mutation().mutationFn(doc)).rejects.toThrow(message);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not erase bytes when metadata RLS deletes zero rows", async () => {
    metadata = { data: [], error: null };
    useDeleteResidentDocument();
    await expect(mutation().mutationFn(doc)).rejects.toThrow("could not be deleted");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("removes only the path returned by the successful metadata deletion", async () => {
    useDeleteResidentDocument();
    await mutation().mutationFn(doc);
    expect(mocks.remove).toHaveBeenCalledWith(["server-path"]);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_resident_document_deletion", { p_document_id: "doc" });
  });

  it("reports durable pending cleanup when Storage returns success but removed no visible rows", async () => {
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockImplementation(async (name: string) => name === "begin_resident_document_deletion" ? metadata : { data: false, error: null });
    useDeleteResidentDocument();
    await expect(mutation().mutationFn(doc)).rejects.toThrow("file deletion is still pending");
    mutation().onSettled(undefined, new Error("pending"), doc);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["resident_documents", "resident"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["resident_document_deletions"] });
  });

  it("fails before deleting bytes when the frontend deploys before the new backend RPC", async () => {
    metadata = { data: null, error: new Error("function does not exist") };
    useDeleteResidentDocument();
    await expect(mutation().mutationFn(doc)).rejects.toThrow("function does not exist");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([false, true])("reconciles a lost Storage response using server confirmation (throws=%s)", async (throws) => {
    if (throws) mocks.remove.mockRejectedValue(new Error("connection lost"));
    else mocks.remove.mockResolvedValue({ data: null, error: new Error("connection lost") });
    useRetryResidentDocumentDeletion();
    await expect(mutation().mutationFn(receipt)).resolves.toBeUndefined();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_resident_document_deletion", { p_document_id: "doc" });
  });

  it("does not claim deletion completed when independent confirmation fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("confirmation unavailable") });
    useRetryResidentDocumentDeletion();
    await expect(mutation().mutationFn(receipt)).rejects.toThrow("file deletion is still pending");
  });

  it("reloads all durable pending receipts from the server, including a second page", async () => {
    const ranges: number[] = [];
    mocks.rpc.mockImplementation(() => ({ range: (from: number) => ({ abortSignal: () => {
      ranges.push(from);
      return Promise.resolve({ data: Array.from({ length: from === 0 ? 500 : 1 }, (_, i) => ({ ...receipt, document_id: `${from + i}` })), error: null });
    } }) }));
    useListPendingResidentDocumentDeletions("resident", true);
    const rows = await mocks.useQuery.mock.calls.at(-1)![0].queryFn({ signal: new AbortController().signal });
    expect(rows).toHaveLength(501);
    expect(ranges).toEqual([0, 500]);
  });

  it("separates pending filenames immediately when actor, tenant, role, or facility changes", () => {
    const keys: string[] = [];
    const capture = () => {
      useListPendingResidentDocumentDeletions(undefined, true);
      keys.push(JSON.stringify(mocks.useQuery.mock.calls.at(-1)![0].queryKey));
    };
    capture();
    for (const [key, value] of [["id", "new-actor"], ["organizationId", "new-org"], ["role", "auditor"], ["facilityId", "new-facility"]]) {
      identity.user = { ...identity.user, [key]: value };
      capture();
    }
    expect(new Set(keys).size).toBe(5);
  });

  it("keeps the query disabled until an active identity has resolved", () => {
    identity.isLoading = true;
    useListPendingResidentDocumentDeletions(undefined, true);
    expect(mocks.useQuery.mock.calls.at(-1)![0].enabled).toBe(false);
    identity.isLoading = false;
    identity.user = null;
    useListPendingResidentDocumentDeletions(undefined, true);
    expect(mocks.useQuery.mock.calls.at(-1)![0].enabled).toBe(false);
  });
});
