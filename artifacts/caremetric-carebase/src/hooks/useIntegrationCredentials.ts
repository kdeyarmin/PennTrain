import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface IntegrationCredentialOption {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  expires_at: string;
  key_prefix: string;
}

/** Active org credentials usable when binding an eMAR (or similar) integration source. */
export function useOrganizationIntegrationCredentials(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["integration-api-credentials", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_api_credentials")
        .select("id,name,scopes,status,expires_at,key_prefix")
        .eq("organization_id", organizationId!)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as IntegrationCredentialOption[];
    },
  });
}

/**
 * The scope `save_medication_integration_source` will actually accept.
 *
 * This used to admit `commands:write` as well, on the reasoning that the command inbox treats it
 * as a superset of `medications:write` (`20260724230000_per_command_integration_contracts.sql`
 * accepts either for `medication.snapshot.import`). The SAVE RPC does not: `20260714210309`
 * line 278 looks the credential up with `'medications:write' = any(c.scopes)` and raises 42501
 * ("Credential is not authorized for this organization and medication scope") for anything else.
 * So the picker offered keys the save then refused, and the refusal named a scope the operator
 * had just chosen from a list. Offer only what the RPC binds; the inbox's wider tolerance is not
 * this dialog's contract.
 */
export const MEDICATION_SOURCE_REQUIRED_SCOPE = "medications:write";

export function credentialSupportsMedicationWrite(credential: IntegrationCredentialOption): boolean {
  return credential.scopes.includes(MEDICATION_SOURCE_REQUIRED_SCOPE);
}

export function credentialIsExpired(credential: IntegrationCredentialOption, now = new Date()): boolean {
  return new Date(credential.expires_at).getTime() <= now.getTime();
}
