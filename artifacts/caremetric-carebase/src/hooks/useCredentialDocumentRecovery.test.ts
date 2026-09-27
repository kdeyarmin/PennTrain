import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ mutation: vi.fn(), upload: vi.fn(), remove: vi.fn(), insert: vi.fn(), read: vi.fn(), eq: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useMutation: h.mutation, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
  from: () => { const query = { select: () => query, insert: () => query, eq: (...args: unknown[]) => { h.eq(...args); return query; }, single: h.insert, maybeSingle: h.read }; return query; },
} }));
import { useUploadCredentialDocument } from "./useCredentialDocuments";
const input = { file: new File(["proof"], "license.pdf"), organizationId: "org", facilityId: "facility", employeeId: "employee", credentialId: "credential" };
const run = () => { useUploadCredentialDocument(); return h.mutation.mock.calls.at(-1)![0].mutationFn(input); };
beforeEach(() => { vi.resetAllMocks(); h.upload.mockResolvedValue({ error: null }); h.remove.mockResolvedValue({ error: null }); h.insert.mockResolvedValue({ data: null, error: new Error("Response lost") }); h.read.mockResolvedValue({ data: null, error: null }); });
describe("credential evidence upload recovery", () => {
  it("recovers a committed document row without deleting the evidence it references", async () => {
    h.read.mockResolvedValue({ data: { id: "saved" }, error: null }); expect(await run()).toEqual({ id: "saved" }); expect(h.remove).not.toHaveBeenCalled();
    expect(h.eq.mock.calls).toEqual([["organization_id", "org"], ["credential_id", "credential"], ["storage_bucket", "credential-documents"], ["storage_path", h.upload.mock.calls[0][0]]]);
  });
  it("retains bytes when a lost response and empty read leave the insert outcome unknown", async () => {
    await expect(run()).rejects.toThrow("refresh the credential documents before retrying"); expect(h.remove).not.toHaveBeenCalled();
  });
  it("retains bytes if the confirmation read also fails", async () => {
    h.read.mockResolvedValue({ error: new Error("Offline") }); await expect(run()).rejects.toThrow("uploaded file was retained"); expect(h.remove).not.toHaveBeenCalled();
  });
  it("cleans only a definitively rejected insert after confirming no matching row exists", async () => {
    h.insert.mockResolvedValue({ error: { code: "42501", message: "Denied" } }); await expect(run()).rejects.toMatchObject({ message: "Denied" });
    expect(h.remove).toHaveBeenCalledWith([h.upload.mock.calls[0][0]]); expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.remove.mock.invocationCallOrder[0]);
  });
});
