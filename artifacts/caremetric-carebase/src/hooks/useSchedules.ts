import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";

export type Schedule = Tables<"schedules">;
export type ScheduleInsert = TablesInsert<"schedules">;
export type ScheduleUpdate = TablesUpdate<"schedules">;

export interface ListSchedulesFilters {
  facilityId?: string;
  status?: string;
}

export function useListSchedules(filters: ListSchedulesFilters = {}) {
  return useQuery({
    queryKey: ["schedules", filters],
    queryFn: async () => {
      let query = supabase.from("schedules").select("*").order("period_start", { ascending: false });
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useGetSchedule(id: string | undefined) {
  return useQuery({
    queryKey: ["schedules", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("schedules").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ScheduleInsert) => {
      const { data, error } = await supabase.from("schedules").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ScheduleUpdate & { id: string }) => {
      const { data, error } = await supabase.from("schedules").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
}

// ---------------------------------------------------------------------------
// Auto-fill: the "reduce manually arranging the schedule" feature. Populates a draft
// schedule from every employee's typical shift/unit pattern, skipping dates an employee
// is already assigned (manual entries always win). clear_auto_filled_assignments is the
// undo -- it only ever removes untouched auto-generated rows, never a manual edit.
// ---------------------------------------------------------------------------

export interface GenerateScheduleAssignmentsResult {
  inserted: number;
  skipped: number;
}

export function useGenerateScheduleAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { data, error } = await supabase.rpc("generate_schedule_assignments", { p_schedule_id: scheduleId });
      if (error) throw error;
      return data as unknown as GenerateScheduleAssignmentsResult;
    },
    onSuccess: (_data, scheduleId) => {
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments", "by-schedule", scheduleId] });
    },
  });
}

export function useClearAutoFilledAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { data, error } = await supabase.rpc("clear_auto_filled_assignments", { p_schedule_id: scheduleId });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (_data, scheduleId) => {
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments", "by-schedule", scheduleId] });
    },
  });
}

export function usePublishSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await supabase.rpc("publish_schedule", { p_schedule_id: scheduleId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
    },
  });
}

export function useUnpublishSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await supabase.rpc("unpublish_schedule", { p_schedule_id: scheduleId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["shift_assignments"] });
    },
  });
}
