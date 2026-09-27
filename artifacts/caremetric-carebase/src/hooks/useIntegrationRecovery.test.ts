import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ mutation: vi.fn(), rpc: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useMutation: h.mutation, useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
import { useEnterpriseRpcCommand } from "./useEnterpriseFoundation";
import { useRotateIntegrationCredential, useRotateWebhookSecret, useRevokeIntegrationCredential } from "./useIntegrationRegister";
const options = (hook: () => unknown) => { hook(); return h.mutation.mock.calls.at(-1)![0]; };
beforeEach(() => { vi.resetAllMocks(); h.invalidate.mockResolvedValue(undefined); h.rpc.mockResolvedValue({ data: null, error: null }); });
describe("integration mutation recovery", () => {
  it.each(["issue_integration_api_credential", "create_integration_webhook_endpoint"])("refreshes the issued register after %s", async rpc => {
    const mutation = options(useEnterpriseRpcCommand); await mutation.onSuccess(null, { rpc, args: {} });
    expect(h.invalidate.mock.calls.map(call => call[0].queryKey)).toEqual([["enterprise-foundation"], ["integration-register"], ["integration-api-credentials"]]);
  });
  it.each([[useRotateIntegrationCredential, { credentialId: "key" }], [useRotateWebhookSecret, { endpointId: "endpoint" }]] as const)("does not claim an empty rotation response left the server unchanged", async (hook, input) => {
    const mutation = options(hook); await expect(mutation.mutationFn(input)).rejects.toThrow("Refresh"); await mutation.onSettled();
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["integration-register"] }); expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["integration-api-credentials"] });
  });
  it("refreshes credential consumers even after a possibly committed revocation rejects", async () => {
    h.rpc.mockResolvedValue({ error: new Error("Response lost") }); const mutation = options(useRevokeIntegrationCredential);
    await expect(mutation.mutationFn({ credentialId: "key", reason: "Rotate compromised key" })).rejects.toThrow("Response lost"); await mutation.onSettled();
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["integration-api-credentials"] });
  });
});
