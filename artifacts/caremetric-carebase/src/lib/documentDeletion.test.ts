import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), bucket: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, storage: { from: (bucket: string) => { h.bucket(bucket); return { remove: h.remove }; } } } }));
import { deleteDocumentWithReceipt, finishDocumentDeletion } from "./documentDeletion";

const receipt = { document_kind: "training", document_id: "document", storage_bucket: "signin-sheets", storage_path: "server/retained-roster.pdf" };
beforeEach(() => {
  vi.resetAllMocks();
  h.rpc.mockImplementation(async name => ({ data: name === "begin_document_deletion" ? [receipt] : true, error: null }));
  h.remove.mockResolvedValue({ data: [{ name: receipt.storage_path }], error: null });
});

describe("authorized document deletion receipts", () => {
  it.each(["23503", "42501", "23514"])("preserves bytes and the definite %s denial", async code => {
    const rejection = { code, message: "The record is retained or deletion is denied" };
    h.rpc.mockResolvedValueOnce({ data: null, error: rejection });
    await expect(deleteDocumentWithReceipt("training", "document")).rejects.toBe(rejection);
    expect(h.remove).not.toHaveBeenCalled(); expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["returned error", "thrown error"])("preserves bytes after an uncertain begin %s", async outcome => {
    if (outcome === "returned error") h.rpc.mockResolvedValueOnce({ data: null, error: { message: "Lost response", code: "503" } });
    else h.rpc.mockRejectedValueOnce(new Error("Lost response"));
    await expect(deleteDocumentWithReceipt("training", "document")).rejects.toThrow("Refresh the document list and Pending file deletions");
    expect(h.remove).not.toHaveBeenCalled(); expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], [receipt, receipt], [{ ...receipt, document_id: "another-document" }], [{ ...receipt, document_kind: "incident" }]])(
    "refuses an empty or mismatched begin receipt %j", async data => {
      h.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(deleteDocumentWithReceipt("training", "document")).rejects.toThrow("could not be confirmed");
      expect(h.remove).not.toHaveBeenCalled(); expect(h.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("uses only the server-owned receipt bucket/path after the metadata deletion", async () => {
    await deleteDocumentWithReceipt("training", "document");
    expect(h.rpc.mock.calls).toEqual([
      ["begin_document_deletion", { p_document_kind: "training", p_document_id: "document" }],
      ["confirm_document_deletion", { p_document_kind: "training", p_document_id: "document" }],
    ]);
    expect(h.bucket).toHaveBeenCalledExactlyOnceWith("signin-sheets"); expect(h.remove).toHaveBeenCalledExactlyOnceWith([receipt.storage_path]);
    expect(h.rpc.mock.invocationCallOrder[0]).toBeLessThan(h.remove.mock.invocationCallOrder[0]);
    expect(h.remove.mock.invocationCallOrder[0]).toBeLessThan(h.rpc.mock.invocationCallOrder[1]);
  });
  it.each(["throws", "error", "zero rows"])("uses authoritative absence after Storage %s", async outcome => {
    if (outcome === "throws") h.remove.mockRejectedValue(new Error("Network unavailable"));
    else h.remove.mockResolvedValue({ data: [], error: outcome === "error" ? { message: "Storage unavailable" } : null });
    await expect(finishDocumentDeletion(receipt)).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("confirm_document_deletion", { p_document_kind: "training", p_document_id: "document" });
  });
  it.each(["throws", "error", "zero rows"])("keeps cleanup pending if bytes remain after Storage %s", async outcome => {
    if (outcome === "throws") h.remove.mockRejectedValue(new Error("Network unavailable"));
    else h.remove.mockResolvedValue({ data: [], error: outcome === "error" ? { message: "Storage unavailable" } : null });
    h.rpc.mockResolvedValue({ data: false, error: null });
    await expect(finishDocumentDeletion(receipt)).rejects.toThrow("file deletion is still pending");
  });
  it("does not infer absence from successful removal when confirmation is unavailable", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("Offline") });
    await expect(finishDocumentDeletion(receipt)).rejects.toThrow("file deletion is still pending");
  });
  it("retries the durable receipt without trying to delete the already-removed metadata again", async () => {
    h.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(finishDocumentDeletion(receipt)).rejects.toThrow("still pending");
    await expect(finishDocumentDeletion(receipt)).resolves.toBeUndefined();
    expect(h.remove).toHaveBeenCalledTimes(2);
    expect(h.remove).toHaveBeenNthCalledWith(1, [receipt.storage_path]); expect(h.remove).toHaveBeenNthCalledWith(2, [receipt.storage_path]);
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["confirm_document_deletion", "confirm_document_deletion"]);
  });
});
