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
 *
 * The second pass (RELEASE_READINESS_PLAN.md section 4.3, Integrations) closes the three that were
 * left: a dead-lettered delivery could only be replayed by a cron-authenticated call to the
 * dispatcher, so not from the product at all; a single event subscription could not be switched
 * off; and switching an endpoint off -- by hand, or now automatically after 25 consecutive
 * failures -- was a one-way door with no way back on.
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

export interface IntegrationSubscriptionRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  is_active: boolean;
}

export interface IntegrationDeadLetterRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  attempt_count: number;
  last_http_status: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  dead_lettered_at: string | null;
  replay_count: number;
}

/** Every subscription, including the switched-off ones -- that is the state being edited. */
export function useIntegrationWebhookSubscriptions(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["integration-register", "subscriptions", organizationId ?? null],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_webhook_subscriptions")
        .select("id,endpoint_id,event_type,is_active")
        .eq("organization_id", organizationId!)
        .order("event_type");
      if (error) throw error;
      return (data ?? []) as IntegrationSubscriptionRow[];
    },
  });
}

/**
 * Deliveries that exhausted their attempts. `get_integration_control_plane` counts them and the
 * Enterprise tab prints the count as JSON; nothing let anyone act on one.
 */
export function useIntegrationDeadLetters(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["integration-register", "dead-letters", organizationId ?? null],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_webhook_deliveries")
        .select("id,endpoint_id,event_type,attempt_count,last_http_status,last_error_code,last_error_message,dead_lettered_at,replay_count")
        .eq("organization_id", organizationId!)
        .eq("status", "dead_letter")
        .order("dead_lettered_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as IntegrationDeadLetterRow[];
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
      // The window is real now: claim_integration_webhook_deliveries returns the previous secret
      // while previous_valid_until is in the future and the dispatcher signs with both, so the
      // fifteen minutes this names is the fifteen minutes the server keeps. It used to be copy
      // over nothing -- the old secret stopped being accepted the instant the new one was minted.
      note: "The previous secret keeps working for 15 minutes: deliveries are signed with both, so hand this one over inside that window.",
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

/**
 * Re-queue a dead-lettered delivery. The RPC files the reason in the audit log and inserts a fresh
 * delivery carrying the same event and payload, so the replay is a new attempt rather than an edit
 * of the record of the failure.
 */
export function useReplayWebhookDelivery() {
  return useRegisterMutation(async (input: { deliveryId: string; reason: string }) => {
    const { data, error } = await supabase.rpc("replay_integration_webhook_delivery" as never, {
      p_delivery_id: input.deliveryId,
      p_reason: input.reason,
    } as never);
    if (error) throw error;
    return data as string;
  });
}

/** Switch one event subscription on or off without touching the endpoint or its other events. */
export function useSetWebhookSubscription() {
  return useRegisterMutation(async (input: { endpointId: string; eventType: string; isActive: boolean }) => {
    const { error } = await supabase.rpc("set_integration_webhook_subscription" as never, {
      p_endpoint_id: input.endpointId,
      p_event_type: input.eventType,
      p_is_active: input.isActive,
    } as never);
    if (error) throw error;
    return true;
  });
}

/** The way back from a deactivation, by hand or automatic. Clears the failure counter with it. */
export function useReactivateWebhookEndpoint() {
  return useRegisterMutation(async (input: { endpointId: string }) => {
    const { error } = await supabase.rpc("reactivate_integration_webhook_endpoint" as never, {
      p_endpoint_id: input.endpointId,
    } as never);
    if (error) throw error;
    return true;
  });
}
