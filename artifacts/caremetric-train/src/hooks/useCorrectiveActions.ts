import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

// Shared by incident findings (Phase 2) and, from Phase 3 on, facility-inspection findings --
// polymorphic on which parent FK is set (see corrective_actions_one_parent_check).
export type CorrectiveAction = Tables<"corrective_actions">;
export type CorrectiveActionInsert = TablesInsert<"corrective_actions">;
export type CorrectiveActionUpdate = TablesUpdate<"corrective_actions">;

export interface ListCorrectiveActionsFilters {
  incidentId?: string;
  inspectionEventId?: string;
  violationId?: string;
  facilityId?: string;
  status?: string;
}

export function useListCorrectiveActions(filters: ListCorrectiveActionsFilters = {}) {
  return useQuery({
    queryKey: ["corrective_actions", filters],
    queryFn: async () => {
      let query = supabase.from("corrective_actions").select("*").order("due_date");
      if (filters.incidentId) query = query.eq("incident_id", filters.incidentId);
      if (filters.inspectionEventId) query = query.eq("inspection_event_id", filters.inspectionEventId);
      if (filters.violationId) query = query.eq("violation_id", filters.violationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCorrectiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CorrectiveActionInsert) => {
      const { data, error } = await supabase.from("corrective_actions").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["corrective_actions"] }),
  });
}

export function useUpdateCorrectiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: CorrectiveActionUpdate & { id: string }) => {
      const { data, error } = await supabase.from("corrective_actions").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["corrective_actions"] }),
  });
}

