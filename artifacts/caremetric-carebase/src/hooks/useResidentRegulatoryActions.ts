import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type ResidentRegulatoryAction = Tables<"resident_regulatory_actions">;

export function useResidentRegulatoryActions(facilityId: string, residentId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["resident_regulatory_actions", facilityId, residentId ?? "facility", user?.id, user?.organizationId, user?.role, user?.facilityId],
    queryFn: async () => {
      const rows: ResidentRegulatoryAction[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.rpc("get_resident_regulatory_actions" as never, { p_facility_id: facilityId, p_resident_id: residentId, p_offset: from } as never) as unknown as { data: ResidentRegulatoryAction[] | null; error: Error | null };
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) return rows;
      }
    },
    enabled: !!facilityId && !!user,
  });
}

export function useSaveResidentRegulatoryAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { rows: TablesInsert<"resident_regulatory_actions">[] } | { id: string; changes: TablesUpdate<"resident_regulatory_actions"> }) => {
      const query = "rows" in payload
        ? supabase.from("resident_regulatory_actions").insert(payload.rows)
        : supabase.from("resident_regulatory_actions").update(payload.changes).eq("id", payload.id);
      const { data, error } = await query.select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["resident_regulatory_actions"] }),
  });
}

export function useSaveResidentClinicalDuty(residentId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (input: { id?: string; actionType: string; details: Json; status: string; anchorAt?: string; reason?: string; completedAt?: string | null; evidence?: string | null; recipientName?: string | null; exceptionBasis?: string | null }) => {
    const { error } = await supabase.rpc("save_resident_clinical_duty" as never, { p_resident_id: residentId, p_action_type: input.actionType, p_details: input.details, p_status: input.status, p_action_id: input.id,
      p_anchor_at: input.anchorAt, p_reason: input.reason, p_completed_at: input.completedAt ?? undefined, p_evidence: input.evidence ?? undefined, p_recipient_name: input.recipientName ?? undefined, p_exception_basis: input.exceptionBasis ?? undefined } as never);
    if (error) throw error;
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["resident_regulatory_actions"] }) });
}
