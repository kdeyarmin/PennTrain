import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Resident = Tables<"residents">;
export type ResidentInsert = TablesInsert<"residents">;
export type ResidentUpdate = TablesUpdate<"residents">;

export interface ListResidentsFilters {
  facilityId?: string;
  status?: string;
}

export function useListResidents(filters: ListResidentsFilters = {}) {
  return useQuery({
    queryKey: ["residents", filters],
    queryFn: async () => {
      let query = supabase.from("residents").select("*").order("last_name");
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetResident(id: string | undefined) {
  return useQuery({
    queryKey: ["residents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("residents").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

// instantiate_resident_compliance_items() fires server-side via
// trigger_instantiate_resident_compliance_on_insert() -- the caller never populates the
// compliance checklist itself, just the resident row.
export function useCreateResident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ResidentInsert) => {
      const { data, error } = await supabase.from("residents").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["residents"] }),
  });
}

export function useUpdateResident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ResidentUpdate & { id: string }) => {
      const { data, error } = await supabase.from("residents").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["residents"] });
      queryClient.invalidateQueries({ queryKey: ["residents", data.id] });
    },
  });
}
