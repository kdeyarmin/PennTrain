/**
 * What has been issued, and how to take it back (BACKLOG.md G15.2-G15.5).
 *
 * The enterprise control plane could issue an API credential and create a webhook endpoint, and
 * that was the whole of it. `revoke_integration_api_credential`,
 * `rotate_integration_api_credential`, `rotate_integration_webhook_secret` and
 * `deactivate_integration_webhook_endpoint` all shipped complete and had no caller anywhere, so a
 * machine credential suspected of leaking could only be left in place, and a webhook could only
 * keep delivering to a URL nobody controlled any more.
 *
 * This is the same one-way door closed for survey-packet guest grants in G9, on credentials rather
 * than on a document -- which is why it is worth doing first among the twenty.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface IntegrationCredentialRow {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  expires_at: string;
  key_prefix: string;
  created_at: string;
}

export interface IntegrationWebhookRow {
  id: string;
  name: string;
  destination_url: string;
  status: string;
  secret_version: number;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  disable_reason: string | null;
}

/** Every credential, not only the active ones: a revoked key is part of the record. */
export function useIntegrationCredentialRegister(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["integration-register", "credentials", organizationId ?? null],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_api_credentials")
        .select("id,name,scopes,status,expires_at,key_prefix,created_at")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as IntegrationCredentialRow[];
    },
  });
}

export function useIntegrationWebhookRegister(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["integration-register", "webhooks", organizationId ?? null],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_webhook_endpoints")
        .select("id,name,destination_url,status,secret_version,consecutive_failures,last_success_at,last_failure_at,disable_reason")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as IntegrationWebhookRow[];
    },
  });
}

/** The plaintext half of a rotation. Returned once by the server and never retrievable again. */
export interface RotatedSecret {
  label: string;
  value: string;
  note: string;
}

function useRegisterMutation<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integration-register"] }),
  });
}

export function useRevokeIntegrationCredential() {
  return useRegisterMutation(async (input: { credentialId: string; reason: string }) => {
    const { error } = await supabase.rpc("revoke_integration_api_credential" as never, {
      p_credential_id: input.credentialId,
      p_reason: input.reason,
    } as never);
    if (error) throw error;
    return true;
  });
}

export function useRotateIntegrationCredential() {
  return useRegisterMutation(async (input: { credentialId: string; expiresAt?: string }): Promise<RotatedSecret> => {
    const { data, error } = await supabase.rpc("rotate_integration_api_credential" as never, {
      p_credential_id: input.credentialId,
      ...(input.expiresAt ? { p_expires_at: input.expiresAt } : {}),
    } as never);
    if (error) throw error;
    // The function returns a one-row TABLE, so PostgREST hands back an array.
    const row = (Array.isArray(data) ? data[0] : data) as { plaintext_key?: string; key_prefix?: string } | null;
    if (!row?.plaintext_key) throw new Error("The rotation returned no key. Nothing was changed.");
    return {
      label: `New API key (${row.key_prefix ?? "no prefix"})`,
      value: row.plaintext_key,
      note: "Copy it now. The server keeps only a hash, so this is the only time it can be read.",
    };
  });
}

export function useRotateWebhookSecret() {
  return useRegisterMutation(async (input: { endpointId: string }): Promise<RotatedSecret> => {
    const { data, error } = await supabase.rpc("rotate_integration_webhook_secret" as never, {
      p_endpoint_id: input.endpointId,
    } as never);
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      { plaintext_signing_secret?: string; secret_version?: number } | null;
    if (!row?.plaintext_signing_secret) throw new Error("The rotation returned no secret. Nothing was changed.");
    return {
      label: `New signing secret (version ${row.secret_version ?? "?"})`,
      value: row.plaintext_signing_secret,
      note: "Give it to the consumer before the old one stops being accepted, or deliveries will fail signature checks.",
    };
  });
}

export function useDeactivateWebhookEndpoint() {
  return useRegisterMutation(async (input: { endpointId: string; reason: string }) => {
    const { error } = await supabase.rpc("deactivate_integration_webhook_endpoint" as never, {
      p_endpoint_id: input.endpointId,
      p_reason: input.reason,
    } as never);
    if (error) throw error;
    return true;
  });
}
