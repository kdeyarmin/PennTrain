/**
 * Custom enterprise role templates (BACKLOG.md G10).
 *
 * `upsert_enterprise_role_template` had no caller. Six built-in templates are seeded by migration,
 * so a grant could always reference one of those -- but a tenant could never define a role of its
 * own, which is the point of a permission-scoped template system as opposed to six fixed roles.
 *
 * The grant console also asked for the template as a raw UUID typed into a text box. Both problems
 * have the same fix: read the templates, which `authenticated` may already select.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type RoleTemplate = Tables<"role_templates">;
export type PermissionDefinition = Tables<"permission_definitions">;

const TEMPLATE_KEY = ["enterprise-foundation", "role-templates"] as const;

export function useEnterpriseRoleTemplates() {
  return useQuery({
    queryKey: TEMPLATE_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_templates")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Permissions a template may contain. Inactive ones are refused by the server with 22023. */
export function usePermissionDefinitions() {
  return useQuery({
    queryKey: [...TEMPLATE_KEY, "permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permission_definitions")
        .select("*")
        .eq("is_active", true)
        .order("permission_key");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRoleTemplatePermissions(roleTemplateId: string | undefined) {
  return useQuery({
    queryKey: [...TEMPLATE_KEY, "assigned", roleTemplateId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_template_permissions")
        .select("permission_key")
        .eq("role_template_id", roleTemplateId!);
      if (error) throw error;
      return (data ?? []).map((row) => row.permission_key);
    },
    enabled: !!roleTemplateId,
  });
}

interface RpcResult { data: unknown; error: { message: string } | null }
interface RpcClient { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

export function useUpsertEnterpriseRoleTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      code: string;
      name: string;
      description: string;
      permissionKeys: string[];
      roleTemplateId?: string | null;
    }) => {
      const { data, error } = await (supabase as unknown as RpcClient).rpc(
        "upsert_enterprise_role_template",
        {
          p_organization_id: input.organizationId,
          p_code: input.code,
          p_name: input.name,
          p_description: input.description,
          p_permission_keys: input.permissionKeys,
          // Null creates; an ID edits the existing template in place, keeping every grant that
          // already points at it.
          p_role_template_id: input.roleTemplateId ?? null,
        },
      );
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["enterprise-foundation"] });
    },
  });
}
