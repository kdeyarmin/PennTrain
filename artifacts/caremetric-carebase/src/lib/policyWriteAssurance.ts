import { supabase } from "@/lib/supabase";

export async function readPolicyWriteAssurance(): Promise<boolean> {
  const { data, error } = await supabase.rpc("identity_assurance_is_current", { p_operation: "policy_document_admin" });
  if (error) throw new Error("Could not verify your session. Retry before changing policies.");
  return data === true;
}

/** Recheck immediately before any write, including an upload opened while assurance was current. */
export async function requirePolicyWriteAssurance(requestVerification: (() => void) | null): Promise<void> {
  if (await readPolicyWriteAssurance()) return;
  requestVerification?.();
  throw new Error("Verify your identity, then submit this policy change again. Your form remains open.");
}
