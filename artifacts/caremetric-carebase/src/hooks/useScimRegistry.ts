/**
 * Directory connections: what exists, and how to rotate or repair one (BACKLOG.md G15.6-G15.8).
 *
 * `create_scim_connection` was wired and nothing else was. A SCIM connection could be created and
 * then never listed, so its credential could not be rotated -- the standing remediation when a
 * directory integration is compromised -- and an SSO identity that failed to auto-match could not
 * be attached to a profile by an administrator.
 *
 * The registry is an RPC rather than a table read because it returns a `credential_hint` instead of
 * the credential: the secret exists once, at rotation, and the registry is deliberately unable to
 * show it again.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }
const rpcClient = supabase as unknown as RpcClient;

export interface ScimConnectionRow {
  connection_id: string;
  organization_id: string;
  connection_key: string;
  display_name: string;
  provider: string;
  status: string;
  default_facility_id: string | null;
  credential_hint: string | null;
  last_rotated_at: string | null;
  created_at: string;
}

export function useScimConnectionRegistry() {
  return useQuery({
    queryKey: ["scim-registry"],
    queryFn: async ({ signal }) => {
      const rows: ScimConnectionRow[] = [];
      for (let from = 0; ; ) {
        const { data, error } = await supabase.rpc("get_scim_connection_registry")
          .order("display_name").order("connection_id").range(from, from + 999).abortSignal(signal);
        if (error) throw error;
        if (!data?.length) return rows;
        rows.push(...data); from += data.length;
      }
    },
  });
}

export interface RotatedScimCredential {
  connectionKey: string;
  secret: string;
}

export function useRotateScimCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { connectionId: string }): Promise<RotatedScimCredential> => {
      const { data, error } = await rpcClient.rpc("rotate_scim_connection_credential", {
        p_connection_id: input.connectionId,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        { connection_key?: string; credential_secret?: string } | null;
      if (!row?.credential_secret || !row.connection_key) throw new Error("The rotation response was incomplete. The credential may have changed. Refresh the registry and rotate again if you did not receive the new secret.");
      return { connectionKey: row.connection_key, secret: row.credential_secret };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["scim-registry"] }),
  });
}

/** How the link was established. The server records it, so an audit can tell them apart. */
export const SSO_LINK_METHODS = [
  { value: "admin_verified", label: "Verified by an administrator" },
  { value: "domain_match", label: "Matched on email domain" },
  { value: "manual", label: "Entered manually" },
] as const;

export function useLinkSsoIdentitySubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ssoConnectionId: string;
      providerSubject: string;
      profileId: string;
      linkMethod: string;
    }) => {
      const { data, error } = await rpcClient.rpc("link_sso_identity_subject", {
        p_sso_connection_id: input.ssoConnectionId,
        p_provider_subject: input.providerSubject,
        p_profile_id: input.profileId,
        p_link_method: input.linkMethod,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scim-registry"] }),
  });
}

export interface SsoConnectionRow {
  id: string;
  display_name: string | null;
  provider: string | null;
  status: string | null;
}

/** SSO connections, so linking a subject does not mean typing a connection UUID. */
export function useSsoConnections() {
  return useQuery({
    queryKey: ["sso-connections"],
    queryFn: async ({ signal }) => {
      const rows: SsoConnectionRow[] = [];
      for (let from = 0; ; ) {
        const { data, error } = await supabase
          .from("organization_sso_connections")
          .select("id, display_name, provider, status")
          .order("display_name").order("id").range(from, from + 999).abortSignal(signal);
        if (error) throw error;
        if (!data?.length) return rows;
        rows.push(...data); from += data.length;
      }
    },
  });
}
