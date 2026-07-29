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

export function credentialSupportsMedicationWrite(credential: IntegrationCredentialOption): boolean {
  return credential.scopes.includes("medications:write") || credential.scopes.includes("commands:write");
}

export function credentialIsExpired(credential: IntegrationCredentialOption, now = new Date()): boolean {
  return new Date(credential.expires_at).getTime() <= now.getTime();
}
