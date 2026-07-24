import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SystemJobStatus {
  job_key: string;
  display_name: string;
  description: string;
  schedule: string | null;
  execution_kind: "sql_cron" | "edge_cron" | "worker" | "external";
  is_critical: boolean;
  retry_mode: "automatic" | "manual" | "none";
  operator_route: string | null;
  last_status: "never" | "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
  last_attempt_at: string | null;
  last_success_at: string | null;
  next_expected_at: string | null;
  last_duration_ms: number | null;
  attempted_count: number | null;
  succeeded_count: number | null;
  failed_count: number | null;
  error_message: string | null;
  is_stale: boolean;
}

export interface SystemJobRecoveryState {
  job_key: string;
  latest_run_id: string | null;
  kill_switch_enabled: boolean;
  kill_switch_reason: string | null;
  circuit_state: "closed" | "open" | "half_open";
  circuit_open_until: string | null;
  last_known_good_at: string | null;
  last_known_good_result: Record<string, unknown>;
  cancellation_pending: boolean;
  dead_letter_count: number;
  latest_dead_letter_run_id: string | null;
  queue_age_ms: number | null;
  failure_rate_24h: number;
  provider_latency_ms_24h: number | null;
  retry_cost_units_24h: number;
}

const JOB_QUERY_KEY = ["system-job-control-plane"] as const;

export function useSystemJobs() {
  return useQuery({
    queryKey: JOB_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_system_job_control_plane");
      if (error) throw error;
      return (data ?? []) as unknown as SystemJobStatus[];
    },
    refetchInterval: 60000,
  });
}

export function useSystemJobRecoveryState() {
  return useQuery({
    queryKey: [...JOB_QUERY_KEY, "recovery"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_system_job_recovery_state");
      if (error) throw error;
      return (data ?? []) as unknown as SystemJobRecoveryState[];
    },
    refetchInterval: 30000,
  });
}

function useRefreshSystemJobs() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: JOB_QUERY_KEY });
}

export function useRunSystemJob() {
  const refresh = useRefreshSystemJobs();
  return useMutation({
    mutationFn: async (input: { jobKey: string; reason: string; replayRunId?: string }) => {
      const { data, error } = await supabase.functions.invoke("run-system-job", {
        body: {
          jobKey: input.jobKey,
          reason: input.reason,
          replayRunId: input.replayRunId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });
}

export function useCancelSystemJob() {
  const refresh = useRefreshSystemJobs();
  return useMutation({
    mutationFn: async (input: { runId: string; reason: string }) => {
      const { error } = await supabase.rpc("request_system_job_cancellation", {
        p_run_id: input.runId,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

// PT-057: dead-lettered Stripe webhook events (processing_status='failed' in
// app_private.stripe_billing_events) surfaced through a platform-admin-only
// RPC, with a retry that replays the stored signed payload.
export interface FailedBillingEvent {
  event_id: string;
  event_type: string;
  event_created_at: string;
  organization_id: string | null;
  organization_name: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_invoice_id: string | null;
  processing_error: string | null;
  failed_at: string | null;
  received_at: string;
  correlation_id: string;
}

const FAILED_BILLING_EVENTS_QUERY_KEY = ["failed-billing-events"] as const;

export function useFailedBillingEvents() {
  return useQuery({
    queryKey: FAILED_BILLING_EVENTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_failed_stripe_billing_events", {
        p_limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as unknown as FailedBillingEvent[];
    },
    refetchInterval: 60000,
  });
}

export function useRetryFailedBillingEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await supabase.rpc("retry_failed_stripe_billing_event", {
        p_event_id: eventId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as {
        was_applied: boolean;
        processing_status: string;
        processing_error: string | null;
      } | undefined;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FAILED_BILLING_EVENTS_QUERY_KEY });
    },
  });
}

export function useSetSystemJobKillSwitch() {
  const refresh = useRefreshSystemJobs();
  return useMutation({
    mutationFn: async (input: { jobKey: string; enabled: boolean; reason: string }) => {
      const { error } = await supabase.rpc("set_system_job_kill_switch", {
        p_job_key: input.jobKey,
        p_enabled: input.enabled,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}
