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

<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/usePracticums.ts
export function useListPracticums(filters: ListPracticumsFilters = {}) {
=======
// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every practicum RLS permits. Passing `enabled: false`
// in that case (rather than `employeeId: undefined`) is the only way to get "no results yet"
// instead of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListPracticums(filters: ListPracticumsFilters = {}, options: { enabled?: boolean } = {}) {
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/usePracticums.ts
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
<<<<<<< HEAD:artifacts/pa-medtrack/src/hooks/usePracticums.ts
=======
    enabled: options.enabled,
>>>>>>> origin/main:artifacts/caremetric-train/src/hooks/usePracticums.ts
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
