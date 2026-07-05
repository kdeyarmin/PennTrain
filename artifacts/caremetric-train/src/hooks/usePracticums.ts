import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Practicum = Tables<"practicums">;
export type PracticumInsert = TablesInsert<"practicums">;
export type PracticumUpdate = TablesUpdate<"practicums">;

export interface ListPracticumsFilters {
  employeeId?: string;
  facilityId?: string;
  status?: string;
  year?: number;
}

export function useListPracticums(filters: ListPracticumsFilters = {}) {
  return useQuery({
    queryKey: ["practicums", filters],
    queryFn: async () => {
      let query = supabase.from("practicums").select("*").order("due_date");
      if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.year) query = query.eq("practicum_year", filters.year);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePracticum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PracticumInsert) => {
      const { data, error } = await supabase.from("practicums").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practicums"] }),
  });
}

export function useUpdatePracticum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: PracticumUpdate & { id: string }) => {
      const { data, error } = await supabase.from("practicums").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practicums"] }),
  });
}
