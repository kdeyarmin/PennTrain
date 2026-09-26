import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
import { requirePolicyWriteAssurance } from "./policyWriteAssurance";

beforeEach(() => vi.clearAllMocks());

it("requires a fresh authoritative operation-specific check for each write", async () => {
  rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
  const reverify = vi.fn();
  await requirePolicyWriteAssurance(reverify);
  expect(reverify).not.toHaveBeenCalled();
  await expect(requirePolicyWriteAssurance(reverify)).rejects.toThrow("Verify your identity");
  expect(reverify).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenNthCalledWith(2, "identity_assurance_is_current", { p_operation: "policy_document_admin" });
});

it("fails closed on missing or unavailable assurance without treating service failure as a successful check", async () => {
  const reverify = vi.fn();
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(requirePolicyWriteAssurance(reverify)).rejects.toThrow("Verify your identity");
  reverify.mockClear();
  rpc.mockResolvedValueOnce({ data: true, error: { message: "private database details" } });
  await expect(requirePolicyWriteAssurance(reverify)).rejects.toThrow("Could not verify your session");
  expect(reverify).not.toHaveBeenCalled();
});
