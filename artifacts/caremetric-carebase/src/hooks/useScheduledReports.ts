import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export const REPORT_KINDS = [
  ["employee_expirations", "Upcoming employee expirations"],
  ["resident_forms_due", "Resident state forms due"],
  ["open_incidents", "Open incidents"],
  ["complaints", "Open complaints and grievances"],
  ["overdue_corrective_actions", "Overdue corrective actions"],
  ["missed_resident_services", "Missed resident services"],
  ["work_orders", "Open work orders"],
  ["fire_drill_compliance", "Fire-drill compliance"],
  ["qapi_metrics", "QAPI metrics"],
  ["occupancy_referral_conversion", "Occupancy and referral conversion"],
] as const;

export type ScheduledReportKind = (typeof REPORT_KINDS)[number][0];
export type ReportFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual";
export type ReportDeliveryMethod = "in_app" | "email_link" | "evidence_room";

export interface ScheduledReport extends Tables<"report_schedules"> {
  report_definition: Pick<Tables<"saved_report_definitions">, "name"> | null;
  recipients: Array<Pick<Tables<"report_schedule_recipients">, "id" | "profile_id" | "delivery_methods"> & {
    profile: Pick<Tables<"profiles">, "first_name" | "last_name" | "email"> | null;
  }>;
}

export interface ScheduledReportRun extends Tables<"report_schedule_runs"> {
  schedule: Pick<Tables<"report_schedules">, "report_kind"> & {
    report_definition: Pick<Tables<"saved_report_definitions">, "name"> | null;
  };
  snapshot: Pick<
    Tables<"report_snapshots">,
    "id" | "reconciliation_status" | "material_totals" | "trend_comparison" | "retention_expires_at" | "facility_id"
  > | null;
  deliveries: Array<Pick<
    Tables<"report_delivery_attempts">,
    "id" | "delivery_method" | "status" | "attempt_number" | "recipient_profile_id" | "notification_delivery_id" | "evidence_collection_id"
  > & {
    recipient: Pick<Tables<"profiles">, "first_name" | "last_name" | "email"> | null;
    provider_delivery: Pick<Tables<"notification_deliveries">, "status" | "final_outcome" | "error_message"> | null;
  }>;
}

export interface ScheduledReportInput {
  scheduleId?: string;
  name: string;
  reportKind: ScheduledReportKind;
  facilityId?: string;
  frequency: ReportFrequency;
  timeZone: string;
  dateRangeMode: "rolling" | "fixed";
  lookbackDays: number;
  fixedDateFrom?: string;
  fixedDateTo?: string;
  fixedAsOfDate?: string;
  deliveryMethods: ReportDeliveryMethod[];
  recipientProfileIds: string[];
  retentionDays: number;
  enabled: boolean;
  publishToEvidenceRoom: boolean;
}

const scheduledReportsKey = ["scheduled-reports"] as const;

export function useScheduledReports() {
  return useQuery({
    queryKey: scheduledReportsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_schedules")
        .select("*, report_definition:saved_report_definitions!report_schedules_report_definition_id_fkey(name), recipients:report_schedule_recipients(id, profile_id, delivery_methods, profile:profiles(first_name, last_name, email))")
        .not("report_kind", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ScheduledReport[];
    },
  });
}

export function useScheduledReportRuns() {
  return useQuery({
    queryKey: [...scheduledReportsKey, "runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_schedule_runs")
        .select("*, schedule:report_schedules(report_kind, report_definition:saved_report_definitions!report_schedules_report_definition_id_fkey(name)), snapshot:report_snapshots!report_schedule_runs_snapshot_id_fkey(id, reconciliation_status, material_totals, trend_comparison, retention_expires_at, facility_id), deliveries:report_delivery_attempts!report_delivery_attempts_run_id_fkey(id, delivery_method, status, attempt_number, recipient_profile_id, notification_delivery_id, evidence_collection_id, recipient:profiles(first_name, last_name, email), provider_delivery:notification_deliveries(status, final_outcome, error_message))")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as ScheduledReportRun[];
    },
  });
}

function invalidateScheduledReports(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: scheduledReportsKey });
}

export function useSaveScheduledReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduledReportInput) => {
      // Supabase's generated function args do not preserve SQL-nullable inputs;
      // PostgreSQL accepts null for these optional scope/date values and validates
      // their combinations inside the RPC.
      const { data, error } = await supabase.rpc("upsert_scheduled_report", {
        p_schedule_id: input.scheduleId ?? null,
        p_name: input.name,
        p_report_kind: input.reportKind,
        p_facility_id: input.facilityId ?? null,
        p_frequency: input.frequency,
        p_time_zone: input.timeZone,
        p_date_range_mode: input.dateRangeMode,
        p_lookback_days: input.lookbackDays,
        p_fixed_date_from: input.fixedDateFrom || null,
        p_fixed_date_to: input.fixedDateTo || null,
        p_fixed_as_of_date: input.fixedAsOfDate || null,
        p_delivery_methods: input.deliveryMethods,
        p_recipient_profile_ids: input.recipientProfileIds,
        p_retention_days: input.retentionDays,
        p_enabled: input.enabled,
        p_publish_to_evidence_room: input.publishToEvidenceRoom,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateScheduledReports(queryClient),
  });
}

export function useSetScheduledReportEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) => {
      const { data, error } = await supabase.rpc("set_report_schedule_enabled", {
        p_schedule_id: scheduleId,
        p_enabled: enabled,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateScheduledReports(queryClient),
  });
}

export function useRunScheduledReportNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ scheduleId, asOfDate }: { scheduleId: string; asOfDate: string }) => {
      const { data, error } = await supabase.rpc("run_scheduled_report_now", {
        p_schedule_id: scheduleId,
        p_as_of_date: asOfDate,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateScheduledReports(queryClient),
  });
}

export function useRetryScheduledReportRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc("retry_scheduled_report_run", { p_run_id: runId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateScheduledReports(queryClient),
  });
}

export function useRetryReportDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data, error } = await supabase.rpc("retry_report_delivery_attempt", { p_attempt_id: attemptId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateScheduledReports(queryClient),
  });
}

export function usePublishReportSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (snapshotId: string) => {
      const { data, error } = await supabase.rpc("publish_report_snapshot_to_evidence_room", {
        p_snapshot_id: snapshotId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateScheduledReports(queryClient),
  });
}
