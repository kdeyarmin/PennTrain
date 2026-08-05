/**
 * Standing enterprise access, and the ability to take it away (BACKLOG.md G10).
 *
 * `grant_enterprise_role` had a caller. `end_enterprise_role_grant` did not -- so every grant the
 * console issued was permanent from the console's point of view. A grant with `effective_to is null`
 * is live access to a scope, and the only way to close one was a manual database write.
 *
 * The read is a plain select: the three tables it joins carry `grant select` to `authenticated` and
 * RLS that already scopes rows to what the caller may see (their own memberships, or scopes where
 * they hold `enterprise.scope.read`). Anything the caller cannot read is a row they also cannot end,
 * so the list and the action agree without a second authorization model.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface StandingGrant {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  reason: string;
  roleTemplateName: string;
  scopeType: string;
  holderName: string;
  holderEmail: string;
}

interface GrantJoinRow {
  id: string;
  effective_from: string;
  effective_to: string | null;
  source: string;
  reason: string;
  role_templates: { name: string | null } | null;
  enterprise_scope_memberships: {
    scope_type: string;
    profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
  } | null;
}

const GRANTS_KEY = ["enterprise-foundation", "access-grants"] as const;

export function useStandingEnterpriseGrants() {
  return useQuery({
    queryKey: GRANTS_KEY,
    queryFn: async (): Promise<StandingGrant[]> => {
      const { data, error } = await supabase
        .from("enterprise_access_grants")
        .select(
          "id, effective_from, effective_to, source, reason," +
            " role_templates(name)," +
            // The FK is named explicitly because `enterprise_scope_memberships` reaches `profiles`
            // twice -- `profile_id` (who holds the access) and `created_by` (who set it up). Left
            // ambiguous, PostgREST refuses the whole query with a 300.
            " enterprise_scope_memberships(scope_type," +
            " profiles!enterprise_scope_memberships_profile_id_fkey(first_name, last_name, email))",
        )
        .is("effective_to", null)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as GrantJoinRow[]).map((row) => {
        const holder = row.enterprise_scope_memberships?.profiles;
        const name = [holder?.first_name, holder?.last_name].filter(Boolean).join(" ").trim();
        return {
          id: row.id,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          source: row.source,
          reason: row.reason,
          roleTemplateName: row.role_templates?.name ?? "Unnamed role template",
          scopeType: row.enterprise_scope_memberships?.scope_type ?? "unknown",
          holderName: name || holder?.email || "Unknown holder",
          holderEmail: holder?.email ?? "",
        };
      });
    },
  });
}

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

export function useEndEnterpriseRoleGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; reason: string; effectiveTo?: string }) => {
      const { error } = await (supabase as unknown as RpcClient).rpc("end_enterprise_role_grant", {
        p_grant_id: input.grantId,
        // Omitting this would take the server's `now()` default, which is right for "end it now"
        // and wrong for backdating to the day someone actually left.
        p_effective_to: input.effectiveTo ?? new Date().toISOString(),
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-foundation"] });
    },
  });
}
