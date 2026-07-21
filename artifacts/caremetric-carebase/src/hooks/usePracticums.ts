import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import { rangeFor } from "@/lib/utils";
import type { PaginatedResult } from "@/lib/dataTable";

export type Practicum = Tables<"practicums">;
export type PracticumInsert = TablesInsert<"practicums">;
export type PracticumUpdate = TablesUpdate<"practicums">;

export interface ListPracticumsFilters {
  employeeId?: string;
  facilityId?: string;
  status?: string;
  year?: number;
}

// `options.enabled` matters for callers that intend to scope by employeeId but don't have one yet
// (e.g. an employee self-service page before its employees row has resolved) -- every filter field
// here is applied only `if` truthy, so an absent employeeId doesn't scope to "nothing," it scopes
// to "no filter at all," silently returning every practicum RLS permits. Passing `enabled: false`
// in that case (rather than `employeeId: undefined`) is the only way to get "no results yet"
// instead of firing twice (once unscoped, once scoped) on every page load. Mirrors
// useCourseAssignments.ts's useListCourseAssignments. Defaults to `undefined`, which react-query
// treats as "always enabled," so every existing caller that doesn't pass `options` is unaffected.
export function useListPracticums(filters: ListPracticumsFilters = {}, options: { enabled?: boolean } = {}) {
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
    enabled: options.enabled,
  });
}

export interface PaginatedPracticumsFilters {
  facilityId?: string;
  status?: string;
  year?: number;
  page: number;
  pageSize: number;
}

// Server-side paginated practicums. The Practicums page resolves employee names client-side from a
// separate useListEmployees() map rather than a Supabase join, so unlike Documents there is no
// embed to preserve here -- we page the practicums rows themselves. Keeps the list's existing
// due_date ordering and adds id as a stable secondary key so rows don't shuffle across pages when
// several share a due_date.
export function usePaginatedPracticums(filters: PaginatedPracticumsFilters) {
  return useQuery({
    queryKey: ["practicums", "paginated", filters],
    queryFn: async ({ signal }): Promise<PaginatedResult<Practicum>> => {
      let query = supabase
        .from("practicums")
        .select("*", { count: "exact" })
        .order("due_date")
        .order("id", { ascending: true })
        .abortSignal(signal);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.year) query = query.eq("practicum_year", filters.year);
      const [from, to] = rangeFor(filters.page, filters.pageSize);
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    placeholderData: (previous) => previous,
  });
}

export function useCreatePracticum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PracticumInsert) => {
      const { data, error } = await supabase.rpc("save_practicum", {
        p_payload: payload as Json,
      });
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
      const { data, error } = await supabase.rpc("save_practicum", {
        p_practicum_id: id,
        p_payload: payload as Json,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["practicums"] }),
  });
}
