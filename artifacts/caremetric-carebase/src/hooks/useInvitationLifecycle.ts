import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { containsFilterValue } from "@/lib/utils";
import type { Tables } from "@/lib/database.types";
import type { BulkInviteRow } from "@/lib/invitationLifecycle";

export type UserInvitation = Tables<"user_invitation_lifecycle">;

export interface InvitationListFilters {
  status?: string;
  role?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useInvitationLifecycle(filters: InvitationListFilters = {}) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return useQuery({
    queryKey: ["user-invitation-lifecycle", filters],
    queryFn: async () => {
      let query = supabase
        .from("user_invitation_lifecycle")
        .select("*", { count: "exact" })
        .order("last_sent_at", { ascending: false })
        .range(from, to);
      if (filters.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (filters.role && filters.role !== "all") {
        query = query.eq("invited_role", filters.role);
      }
      if (filters.search?.trim()) {
        const like = containsFilterValue(filters.search.trim());
        query = query.or(
          `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`,
        );
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data as UserInvitation[], total: count ?? 0 };
    },
  });
}

interface EdgeFunctionErrorShape {
  success?: boolean;
  message?: string;
  error?: string;
}

async function invokeEdgeFunction<TResponse>(functionName: string, body: object): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse & EdgeFunctionErrorShape>(functionName, { body });
  if (error) throw error;
  if (data && data.success === false) {
    throw new Error(data.error ?? data.message ?? `${functionName} failed`);
  }
  return data as TResponse;
}

export function useRevokeInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ invitationId, reason }: { invitationId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("revoke_user_invitation" as never, {
        p_invitation_id: invitationId,
        p_reason: reason,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["user-invitation-lifecycle"] }),
  });
}

export function useResendInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) =>
      invokeEdgeFunction<{ success?: boolean; invitation_id?: string; email?: string }>(
        "resend-invitation",
        { invitation_id: invitationId },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["user-invitation-lifecycle"] }),
  });
}

export function useBulkInviteUsers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      rows: BulkInviteRow[];
      organizationId: string | null;
      redirectTo: string;
    }) => {
      const results: Array<{ email: string; success: boolean; error?: string }> = [];
      for (const row of input.rows) {
        try {
          await invokeEdgeFunction<{ success?: boolean }>("invite-user", {
            email: row.email,
            first_name: row.firstName,
            last_name: row.lastName,
            role: row.role,
            organization_id: input.organizationId,
            employee_id: row.employeeId,
            redirect_to: input.redirectTo,
          });
          results.push({ email: row.email, success: true });
        } catch (error) {
          results.push({
            email: row.email,
            success: false,
            error: error instanceof Error ? error.message : "Invite failed",
          });
        }
      }
      return results;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["user-invitation-lifecycle"] });
      client.invalidateQueries({ queryKey: ["profiles"] });
      client.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}
