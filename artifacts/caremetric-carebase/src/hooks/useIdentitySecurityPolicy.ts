import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

/**
 * The organization's own identity posture, read from the table that decides it.
 *
 * BACKLOG J74 (P3, identity). `public.identity_security_policies` is what
 * `identity_operation_requires_aal2()` and `identity_assurance_is_current()` consult on every
 * privileged action, and nothing in the product ever read it or wrote it. Settings instead printed
 * one hard-coded sentence -- "administrators and facility managers must enroll TOTP; irreversible
 * actions require a fresh AAL2 session" -- which is only the DEFAULT, and said nothing at all about
 * `max_privileged_session_minutes`, the setting that decides how long an administrator can work
 * before every privileged button starts answering 42501.
 */
export type IdentitySecurityPolicy = Tables<"identity_security_policies">;

/**
 * What the database falls back to when an organization has no row, taken from
 * `identity_operation_requires_aal2()`'s own not-found branch and the column defaults. Kept here so
 * the page can render the posture that is actually in force rather than an empty card.
 */
export const DEFAULT_IDENTITY_SECURITY_POLICY = {
  privileged_roles: ["org_admin", "facility_manager"],
  require_aal2: true,
  max_privileged_session_minutes: 480,
  sensitive_operations: [
    "regulatory_rule_approval",
    "regulatory_rule_activation",
    "identity_admin",
    "session_revocation",
    "break_glass",
    "scim_credential_rotation",
    "enterprise_scope_admin",
    "workforce_admin",
    "compliance_profile_admin",
    "billing_admin",
    "integration_admin",
    "evidence_grant_revoke",
    "schedule_unpublish",
    "course_unpublish",
    "policy_document_admin",
    "confidential_identity_reveal",
  ],
} as const;

export interface EffectiveIdentitySecurityPolicy {
  privilegedRoles: string[];
  requireAal2: boolean;
  maxPrivilegedSessionMinutes: number;
  sensitiveOperations: string[];
  /** False when the organization has never saved a row and the database defaults are in force. */
  isExplicit: boolean;
  updatedAt: string | null;
}

export function useIdentitySecurityPolicy(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["identity_security_policy", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<EffectiveIdentitySecurityPolicy> => {
      const { data, error } = await supabase
        .from("identity_security_policies")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return {
          privilegedRoles: [...DEFAULT_IDENTITY_SECURITY_POLICY.privileged_roles],
          requireAal2: DEFAULT_IDENTITY_SECURITY_POLICY.require_aal2,
          maxPrivilegedSessionMinutes: DEFAULT_IDENTITY_SECURITY_POLICY.max_privileged_session_minutes,
          sensitiveOperations: [...DEFAULT_IDENTITY_SECURITY_POLICY.sensitive_operations],
          isExplicit: false,
          updatedAt: null,
        };
      }
      return {
        privilegedRoles: data.privileged_roles,
        requireAal2: data.require_aal2,
        maxPrivilegedSessionMinutes: data.max_privileged_session_minutes,
        sensitiveOperations: data.sensitive_operations,
        isExplicit: true,
        updatedAt: data.updated_at,
      };
    },
  });
}

/**
 * Writes the one field an organization can actually move.
 *
 * `identity_security_policy_mfa_floor` is a CHECK constraint, not a preference: `require_aal2` must
 * stay true, `privileged_roles` must still contain org_admin and facility_manager, and
 * `sensitive_operations` must still contain the fifteen baseline operations. So the settable part
 * of this posture is the privileged session window (5-480 minutes), and offering a switch for the
 * rest would be offering a control the database refuses.
 *
 * The caller passes the policy it is looking at, and its roles and operations are written back
 * unchanged. PostgREST upserts by writing every column in the payload, so composing the payload
 * from the baseline instead would silently narrow an organization whose posture had been widened
 * outside the product.
 *
 * The `identity_security_policies_manage` RLS policy also requires
 * `identity_assurance_is_current('identity_admin')`, so an org_admin on a stale or AAL1 session gets
 * a row-level-security refusal here -- which is the correct answer, and the caller shows it.
 */
export function useSetPrivilegedSessionWindow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ organizationId, minutes, current, updatedBy }: {
      organizationId: string;
      minutes: number;
      current: EffectiveIdentitySecurityPolicy;
      updatedBy: string | null;
    }) => {
      const { data, error } = await supabase
        .from("identity_security_policies")
        .upsert({
          organization_id: organizationId,
          max_privileged_session_minutes: minutes,
          require_aal2: current.requireAal2,
          privileged_roles: current.privilegedRoles,
          sensitive_operations: current.sensitiveOperations,
          updated_by: updatedBy,
        }, { onConflict: "organization_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["identity_security_policy"] }),
  });
}
