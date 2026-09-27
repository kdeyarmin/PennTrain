import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  useMutation: vi.fn(), from: vi.fn(), storage: vi.fn(), upload: vi.fn(), remove: vi.fn(),
  invalidateQueries: vi.fn(), assurance: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useMutation: h.useMutation, useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from, storage: { from: h.storage } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({}) }));
vi.mock("./useResidentAssessmentForms", () => ({ describeFunctionError: vi.fn() }));
vi.mock("@/lib/identityReverification", () => ({ useRequestIdentityVerification: () => vi.fn() }));
vi.mock("@/lib/policyWriteAssurance", () => ({ requirePolicyWriteAssurance: h.assurance }));

import { useUploadResidentDocument } from "./useResidentDocuments";
import { useUploadPolicyDocumentVersion } from "./usePolicyDocuments";

let insertResult: { data: unknown; error: unknown };
let readResult: { data: unknown; error: unknown };
let readThrows: boolean;
let filters: Array<[string, unknown]>;
let inserted: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  insertResult = { data: null, error: { message: "response lost", code: "" } };
  readResult = { data: null, error: null };
  readThrows = false; filters = []; inserted = {};
  h.assurance.mockResolvedValue(undefined);
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
  h.storage.mockImplementation(() => ({ upload: h.upload, remove: h.remove }));
  h.from.mockImplementation(() => {
    const query = {
      insert: (value: Record<string, unknown>) => { inserted = value; return query; },
      select: () => query,
      single: async () => insertResult,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: async () => { if (readThrows) throw new Error("offline"); return readResult; },
    };
    return query;
  });
});

describe.each([
  ["resident", "resident_documents", "resident-documents", "resident_id", "resident", useUploadResidentDocument],
  ["policy", "policy_document_versions", "policy-documents", "policy_document_id", "policy", useUploadPolicyDocumentVersion],
] as const)("%s document upload reconciliation", (_kind, table, bucket, parentColumn, parentId, useUpload) => {
  const save = () => {
    useUpload();
    return h.useMutation.mock.calls.at(-1)![0].mutationFn({
      file: new File(["evidence"], "form.pdf", { type: "application/pdf" }), organizationId: "org", facilityId: "facility",
      residentId: "resident", policyDocumentId: "policy", versionNumber: 2, createdBy: "actor",
    });
  };

  it("returns the committed exact-path record after a lost write response without deleting bytes", async () => {
    const saved = { id: "saved", [parentColumn]: parentId };
    readResult = { data: saved, error: null };
    await expect(save()).resolves.toBe(saved);
    expect(h.from.mock.calls.map(call => call[0])).toEqual([table, table]);
    expect(filters).toEqual([
      ["organization_id", "org"], [parentColumn, parentId], ["storage_bucket", bucket], ["storage_path", inserted.storage_path],
    ]);
    expect(h.upload).toHaveBeenCalledWith(inserted.storage_path, expect.any(File));
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("retains bytes after an ambiguous write even when the immediate reconciliation read is empty", async () => {
    await expect(save()).rejects.toThrow("could not be confirmed");
    expect(h.remove).not.toHaveBeenCalled();
  });

  it.each([false, true])("retains bytes when the reconciliation read fails (throws=%s)", async (throws) => {
    insertResult.error = { message: "permission denied", code: "42501" };
    if (throws) readThrows = true;
    else readResult.error = new Error("lookup failed");
    await expect(save()).rejects.toThrow("uploaded file was retained");
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("cleans only this upload after a definitive rejection and confirmed absent metadata", async () => {
    const rejection = { message: "invalid parent", code: "23503" };
    insertResult.error = rejection;
    await expect(save()).rejects.toBe(rejection);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith([inserted.storage_path]);
  });

  it.each([false, true])("reports a cleanup failure without losing the original rejection (throws=%s)", async (throws) => {
    insertResult.error = { message: "invalid parent", code: "23503" };
    if (throws) h.remove.mockRejectedValue(new Error("connection lost"));
    else h.remove.mockResolvedValue({ error: new Error("cleanup failed") });
    await expect(save()).rejects.toThrow("invalid parent (the uploaded file could not be removed");
  });

  it("leaves a successful upload intact and skips reconciliation", async () => {
    const saved = { id: "saved", [parentColumn]: parentId };
    insertResult = { data: saved, error: null };
    await expect(save()).resolves.toBe(saved);
    expect(h.from).toHaveBeenCalledOnce();
    expect(h.remove).not.toHaveBeenCalled();
  });
});
