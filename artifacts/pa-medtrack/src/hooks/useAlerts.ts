import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesUpdate } from "@/lib/database.types";

export type Alert = Tables<"alerts">;
export type AlertUpdate = TablesUpdate<"alerts">;

export interface ListAlertsFilters {
  facilityId?: string;
  status?: string;
  severity?: string;
}

export function useListAlerts(filters: ListAlertsFilters = {}) {
  return useQuery({
    queryKey: ["alerts", filters],
    queryFn: async () => {
      let query = supabase.from("alerts").select("*").order("created_at", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.severity) query = query.eq("severity", filters.severity);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: AlertUpdate & { id: string }) => {
      const { data, error } = await supabase.from("alerts").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useBulkUpdateAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, ...payload }: AlertUpdate & { ids: string[] }) => {
      const { data, error } = await supabase.from("alerts").update(payload).in("id", ids).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });
}
