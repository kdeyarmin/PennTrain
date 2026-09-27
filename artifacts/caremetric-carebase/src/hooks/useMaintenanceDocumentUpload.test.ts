import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ mutation: vi.fn(), upload: vi.fn(), remove: vi.fn(), insert: vi.fn(), read: vi.fn(), eq: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useMutation: h.mutation, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
  from: () => { const q = { select: () => q, insert: () => q, eq: (...args: unknown[]) => { h.eq(...args); return q; }, single: h.insert, maybeSingle: h.read }; return q; },
} }));
import { useUploadMaintenanceDocument } from "./useWorkOrders";
const input = { file: new File(["pdf"], "record.pdf"), organizationId: "org", facilityId: "facility", workOrderId: "work-order", documentType: "invoice" };
const run = () => { useUploadMaintenanceDocument(); return h.mutation.mock.calls.at(-1)![0].mutationFn(input); };
beforeEach(() => { vi.resetAllMocks(); h.upload.mockResolvedValue({ error: null }); h.remove.mockResolvedValue({ error: null }); h.insert.mockResolvedValue({ data: null, error: new Error("Response lost") }); h.read.mockResolvedValue({ data: null, error: null }); });
describe("maintenance document upload outcomes", () => {
  it("recovers matching committed metadata without deleting its file", async () => {
    h.read.mockResolvedValue({ data: { id: "saved" }, error: null }); expect(await run()).toEqual({ id: "saved" }); expect(h.remove).not.toHaveBeenCalled();
    expect(h.eq.mock.calls).toEqual([["organization_id", "org"], ["storage_bucket", "maintenance-documents"], ["storage_path", h.upload.mock.calls[0][0]]]);
  });
  it("retains uncertain bytes after an empty read because the write may still commit", async () => {
    await expect(run()).rejects.toThrow("refresh the document list before retrying"); expect(h.remove).not.toHaveBeenCalled();
  });
  it("retains bytes when verification fails", async () => {
    h.read.mockResolvedValue({ error: new Error("Offline") }); await expect(run()).rejects.toThrow("uploaded file was retained"); expect(h.remove).not.toHaveBeenCalled();
  });
  it("cleans a staged file only after definitive rejection and confirmed absence", async () => {
    h.insert.mockResolvedValue({ error: { code: "42501", message: "Denied" } }); await expect(run()).rejects.toMatchObject({ message: "Denied" });
    expect(h.remove).toHaveBeenCalledWith([h.upload.mock.calls[0][0]]); expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.remove.mock.invocationCallOrder[0]);
  });
});
