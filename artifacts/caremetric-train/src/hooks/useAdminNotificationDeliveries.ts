import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type NotificationDelivery = Tables<"notification_deliveries"> & {
  template_version_id?: string | null;
  parent_delivery_id?: string | null;
  fallback_group_id?: string;
  fallback_sequence?: number;
  escalation_reason?: string | null;
};

export interface NotificationOperationsSummary {
  pending: number;
  processing: number;
  awaitingFinal: number;
  delivered: number;
  failed: number;
  unknown: number;
  fallbacks: number;
  fallbackDelivered: number;
}

export interface NotificationSpendSummary {
  organizationId: string;
  organizationName: string;
  estimatedSpendMicros: number;
  budgetMicros: number | null;
  warningPercent: number | null;
}

export interface NotificationSpendAlert {
  id: string;
  organizationId: string;
  organizationName: string;
  thresholdPercent: number;
  estimatedSpendMicros: number;
  budgetMicros: number;
  createdAt: string;
}

export interface NotificationOperations {
  summary: NotificationOperationsSummary;
  spend: NotificationSpendSummary[];
  spendAlerts: NotificationSpendAlert[];
  policies: Array<{
    organizationId: string;
    fallbackEnabled: boolean;
    fallbackDelayMinutes: number;
    maxFallbackDepth: number;
    monthlyBudgetMicros: number | null;
    warningPercent: number;
    emailEstimateMicros: number;
    smsEstimateMicros: number;
  }>;
  templates: { active: number; draft: number; retired: number };
}

export interface NotificationTemplateVersion {
  id: string;
  organizationId: string | null;
  templateKey: string;
  channel: "email" | "sms";
  version: number;
  status: "draft" | "active" | "retired";
  subjectTemplate: string;
  bodyTemplate: string;
  allowedVariables: string[];
  activatedAt: string | null;
  createdAt: string;
}

export interface NotificationDeliveryEvidence {
  delivery: NotificationDelivery;
  template: {
    id: string;
    key: string;
    channel: string;
    version: number;
    status: string;
  } | null;
  attempts: Tables<"notification_delivery_attempts">[];
  events: Tables<"notification_provider_events">[];
}

async function callNotificationRpc<T>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  // The migration and generated database types land in the same release. The
  // narrow cast keeps this hook usable while preserving typed results locally.
  const { data, error } = await supabase.rpc(functionName as never, args as never);
  if (error) throw error;
  return data as T;
}

export interface ListNotificationDeliveriesFilters {
  organizationId?: string;
  status?: string;
  channel?: string;
  limit?: number;
}

// RLS on notification_deliveries grants platform_admin unrestricted cross-org
// SELECT (is_platform_admin() OR own-org read for org_admin/facility_manager),
// so this query needs no client-side org scoping -- platform_admin callers
// naturally get every organization's rows back.
export function useListNotificationDeliveries(filters: ListNotificationDeliveriesFilters = {}) {
  return useQuery({
    queryKey: ["notification_deliveries", filters],
    queryFn: async () => {
      let query = supabase
        .from("notification_deliveries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 200);
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.channel) query = query.eq("channel", filters.channel);
      const { data, error } = await query;
      if (error) throw error;
      return data as NotificationDelivery[];
    },
    // Delivery status is time-sensitive (e.g. a retry just succeeded in another tab) -- opt out
    // of the app-wide 60s staleTime/refetchOnWindowFocus:false default in queryClient.ts.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useRetryNotificationDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const { error } = await supabase.rpc("retry_notification_delivery", { p_delivery_id: deliveryId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_deliveries"] }),
  });
}

// retry_notification_delivery only ever takes one id at a time -- it's not a plain column update
// like useBulkUpdateAlerts' bulk status change, so there's no single batchable SQL statement to
// call instead. "Retry Selected Failed" loops the same per-row RPC client-side via
// Promise.allSettled so one delivery that fails to re-queue (e.g. it moved out of "failed" state
// between selection and click) doesn't abort the rest of the batch. Returns the raw settle results
// so the caller can build one summary toast from the counts.
export function useBulkRetryNotificationDeliveries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryIds: string[]) => {
      const results = await Promise.allSettled(
        deliveryIds.map(async (deliveryId) => {
          const { error } = await supabase.rpc("retry_notification_delivery", { p_delivery_id: deliveryId });
          if (error) throw error;
        }),
      );
      return results;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_deliveries"] }),
  });
}

// Simple id -> name lookup so the oversight page can show organization names
// instead of raw UUIDs (see ROADMAP: raw-UUID reports called out as a defect
// to avoid repeating).
export function useOrganizationNameMap() {
  return useQuery({
    queryKey: ["organizations", "name_map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id, name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const org of data ?? []) map[org.id] = org.name;
      return map;
    },
  });
}

export function useNotificationDeliveryOperations(organizationId?: string) {
  return useQuery({
    queryKey: ["notification_delivery_operations", organizationId ?? "all"],
    queryFn: () => callNotificationRpc<NotificationOperations>(
      "get_notification_delivery_operations",
      { p_organization_id: organizationId ?? null, p_hours: 24 },
    ),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useNotificationDeliveryEvidence(deliveryId: string | null) {
  return useQuery({
    queryKey: ["notification_delivery_evidence", deliveryId],
    queryFn: () => callNotificationRpc<NotificationDeliveryEvidence>(
      "get_notification_delivery_evidence",
      { p_delivery_id: deliveryId },
    ),
    enabled: Boolean(deliveryId),
  });
}

export function useNotificationTemplateLibrary(organizationId?: string) {
  return useQuery({
    queryKey: ["notification_template_library", organizationId ?? "all"],
    queryFn: () => callNotificationRpc<NotificationTemplateVersion[]>(
      "get_notification_template_library",
      { p_organization_id: organizationId ?? null },
    ),
  });
}

export function usePreviewNotificationTemplate() {
  return useMutation({
    mutationFn: (input: {
      subjectTemplate: string;
      bodyTemplate: string;
      allowedVariables: string[];
      variables: Record<string, string>;
    }) => callNotificationRpc<{ subject: string; body: string }>(
      "preview_notification_template_draft",
      {
        p_subject_template: input.subjectTemplate,
        p_body_template: input.bodyTemplate,
        p_allowed_variables: input.allowedVariables,
        p_variables: input.variables,
      },
    ),
  });
}

export function useCreateNotificationTemplateVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      organizationId?: string;
      templateKey: string;
      channel: "email" | "sms";
      subjectTemplate: string;
      bodyTemplate: string;
      allowedVariables: string[];
    }) => callNotificationRpc<string>("create_notification_template_version", {
      p_organization_id: input.organizationId ?? null,
      p_template_key: input.templateKey,
      p_channel: input.channel,
      p_subject_template: input.subjectTemplate,
      p_body_template: input.bodyTemplate,
      p_allowed_variables: input.allowedVariables,
      p_activate: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification_template_library"] });
      queryClient.invalidateQueries({ queryKey: ["notification_delivery_operations"] });
    },
  });
}

export function useActivateNotificationTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => callNotificationRpc<void>(
      "activate_notification_template",
      { p_template_id: templateId },
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_template_library"] }),
  });
}

export function useSetNotificationSpendPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      organizationId: string;
      monthlyBudgetUsd: number | null;
      emailEstimateUsd: number;
      smsEstimateUsd: number;
      warningPercent: number;
    }) => callNotificationRpc<void>("set_notification_spend_policy", {
      p_organization_id: input.organizationId,
      p_monthly_budget_usd: input.monthlyBudgetUsd,
      p_email_estimate_usd: input.emailEstimateUsd,
      p_sms_estimate_usd: input.smsEstimateUsd,
      p_warning_percent: input.warningPercent,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_delivery_operations"] }),
  });
}

export function useSetNotificationChannelPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      organizationId: string;
      fallbackEnabled: boolean;
      fallbackDelayMinutes: number;
      maxFallbackDepth: number;
    }) => callNotificationRpc<void>("set_notification_channel_policy", {
      p_organization_id: input.organizationId,
      p_fallback_enabled: input.fallbackEnabled,
      p_fallback_delay_minutes: input.fallbackDelayMinutes,
      p_max_fallback_depth: input.maxFallbackDepth,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_delivery_operations"] }),
  });
}

export function useAcknowledgeNotificationSpendAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => callNotificationRpc<void>(
      "acknowledge_notification_spend_alert",
      { p_alert_id: alertId },
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification_delivery_operations"] }),
  });
}
