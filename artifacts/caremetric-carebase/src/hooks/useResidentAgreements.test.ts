import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), invalidateQueries: vi.fn(), mutation: null as {
  mutationFn: (input: Record<string, unknown>) => Promise<unknown>;
  onSuccess: (data: unknown, input: { residentId: string }) => void;
} | null }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
  useMutation: (options: typeof h.mutation) => { h.mutation = options; return {}; },
}));
import { useRecordResidentAgreementOutcome } from "./useResidentAgreements";

const response = {
  residentId: "resident-a", versionId: "version-a", outcome: "signed", signerName: "Avery Resident",
  signerRole: "resident", relationship: "Self", attestation: "I signed this exact agreement.",
  authenticationMethod: "wet_signature_import", signedAt: "2026-09-20T15:30:00Z", signedDocumentId: "document-a",
};
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  vi.stubGlobal("navigator", { userAgent: "agreement-test" });
  h.rpc.mockReset().mockResolvedValue({ data: "signature-a", error: null });
  h.invalidateQueries.mockReset(); useRecordResidentAgreementOutcome();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("documented wet agreement imports", () => {
  it("sends the actual historical time and signed document through the guarded import RPC", async () => {
    expect(await h.mutation!.mutationFn(response)).toBe("signature-a");
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("record_resident_agreement_wet_outcome", expect.objectContaining({
      p_version_id: "version-a", p_signed_at: "2026-09-20T15:30:00Z", p_signed_document_id: "document-a",
      p_device_evidence: "agreement-test",
    }));
  });
  it.each([
    [{ signedAt: undefined }, /actual signing date/],
    [{ signedAt: "invalid" }, /actual signing date/],
    [{ signedAt: "2026-09-27T00:00:00Z" }, /future/],
    [{ signedDocumentId: undefined }, /signed document/],
    [{ signedDocumentId: "none" }, /signed document/],
  ])("refuses incomplete import evidence before any write: %j", async (override, error) => {
    await expect(h.mutation!.mutationFn({ ...response, ...override })).rejects.toThrow(error);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("preserves the existing electronic-signature RPC and does not supply historical evidence", async () => {
    await h.mutation!.mutationFn({ ...response, authenticationMethod: "staff_session" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("record_resident_agreement_outcome", expect.objectContaining({ p_authentication_method: "staff_session" }));
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty("p_signed_at");
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty("p_signed_document_id");
  });
  it("surfaces resident-scope validation failures and refreshes regulatory duties only after success", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("Signed document must belong to this resident and facility") });
    await expect(h.mutation!.mutationFn(response)).rejects.toThrow(/this resident/);
    expect(h.invalidateQueries).not.toHaveBeenCalled();
    h.mutation!.onSuccess("signature-a", response);
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["resident_regulatory_actions"] });
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["resident-agreements", "resident-a"] });
  });
});
