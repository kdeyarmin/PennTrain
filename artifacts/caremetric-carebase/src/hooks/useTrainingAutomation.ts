import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import type { SavedTrainingFilters } from "@/lib/trainingAutomation";

export interface TrainingReminderPolicy {
  learner_enabled: boolean; lead_days: number; repeat_days: number; digest_enabled: boolean;
  digest_weekday: number; escalation_days: number; recipient_ids: string[];
}
export interface TrainingReportSchedule {
  id: string; name: string; facility_id: string; filters: SavedTrainingFilters; frequency: "weekly" | "monthly";
  delivery_day: number; recipient_ids: string[]; enabled: boolean; next_run_on: string;
  runs: { scheduled_on: string; queued_at: string; recipient_count: number }[];
}
export interface TrainingAutomation {
  settings: TrainingReminderPolicy;
  recipients: { id: string; name: string; role: string }[];
  schedules: TrainingReportSchedule[];
}
export function useTrainingAutomation(facilityId: string, enabled = true) {
  return useQuery({ queryKey: ["training-automation", facilityId], enabled: enabled && !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_automation", { p_facility_id: facilityId });
      if (error) throw error;
      const value = data as unknown as TrainingAutomation;
      if (!value?.settings || !Array.isArray(value.recipients) || !Array.isArray(value.schedules)) throw new Error("Training automation settings are unavailable.");
      return value;
    }, staleTime: 0,
  });
}
export function useSaveTrainingReminderPolicy(facilityId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (settings: TrainingReminderPolicy) => {
    const { error } = await supabase.rpc("save_training_reminder_policy", { p_facility_id: facilityId, p_settings: settings as unknown as Json });
    if (error) throw error;
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["training-automation", facilityId] }) });
}
export function useSaveTrainingReportSchedule(facilityId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (schedule: { id?: string; name: string; filters: SavedTrainingFilters;
    frequency: "weekly" | "monthly"; day: number; recipients: string[]; enabled: boolean }) => {
    const { data, error } = await supabase.rpc("save_training_report_schedule", { p_facility_id: facilityId,
      p_schedule_id: schedule.id, p_name: schedule.name, p_filters: schedule.filters as unknown as Json,
      p_frequency: schedule.frequency, p_delivery_day: schedule.day, p_recipient_ids: schedule.recipients, p_enabled: schedule.enabled });
    if (error) throw error;
    return data;
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["training-automation", facilityId] }) });
}
export function useSavedTrainingReport(id?: string) {
  return useQuery({ queryKey: ["training-automation", "saved", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_saved_training_report", { p_schedule_id: id! });
      if (error) throw error;
      const value = data as unknown as { id: string; name: string; organizationId: string; facilityId: string; filters: SavedTrainingFilters };
      if (!value?.id || !value.filters || !value.organizationId || !value.facilityId) throw new Error("Saved report filters could not be loaded.");
      return value;
    }, staleTime: 0,
  });
}
export interface TrainingReportAnalytics {
  matching_enrollments: number; stalled_days: number; stalled_total: number;
  departments: { department: string; students: number; required: number; completed: number; not_started: number }[];
  months: { month: string; completions: number }[];
  stalled: { id: string; employee_id: string; student: string; course: string; percent_complete: number; last_progress_at: string }[];
}
export function useTrainingReportAnalytics(facilityId: string, filters: SavedTrainingFilters, stalledDays: number, enabled: boolean) {
  return useQuery({ queryKey: ["training-enrollment-report", "analytics", facilityId, filters, stalledDays], enabled: enabled && !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_report_analytics", { p_facility_id: facilityId, p_filters: filters as unknown as Json, p_stalled_days: stalledDays });
      if (error) throw error;
      const value = data as unknown as TrainingReportAnalytics;
      if (!value || !Array.isArray(value.departments) || !Array.isArray(value.months) || !Array.isArray(value.stalled)) throw new Error("Training analytics are unavailable.");
      return value;
    }, staleTime: 0,
  });
}
