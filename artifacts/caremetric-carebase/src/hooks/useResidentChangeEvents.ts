import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type ResidentChangeEvent = Tables<"resident_change_events">;
export type ResidentChangeMonitoringEntry = Tables<"resident_change_monitoring_entries">;
export type ResidentChangeFollowUp = Tables<"resident_change_follow_ups">;
export type ResidentChangeEventHistory = Tables<"resident_change_event_history">;

export interface ResidentChangeEventWithRelations extends ResidentChangeEvent {
  resident: { id: string; first_name: string; last_name: string; room: string | null; status: string } | null;
  facility: { id: string; name: string } | null;
  assigned: { id: string; first_name: string; last_name: string } | null;
  identified_by: { id: string; first_name: string; last_name: string } | null;
  compliance_item: { id: string; status: string; due_date: string | null } | null;
  incident: { id: string; status: string; severity: string } | null;
}

export interface ChangeEventMonitoringWithRecorder extends ResidentChangeMonitoringEntry {
  recorder: { id: string; first_name: string; last_name: string } | null;
}

export interface ChangeEventFollowUpWithAssignee extends ResidentChangeFollowUp {
  assigned: { id: string; first_name: string; last_name: string } | null;
  completed_by: { id: string; first_name: string; last_name: string } | null;
}

export interface ChangeEventHistoryWithActor extends ResidentChangeEventHistory {
  actor: { id: string; first_name: string; last_name: string } | null;
}

const CHANGE_EVENT_SELECT = `
  *,
  resident:residents(id, first_name, last_name, room, status),
  facility:facilities(id, name),
  assigned:profiles!resident_change_events_assigned_profile_id_fkey(id, first_name, last_name),
  identified_by:profiles!resident_change_events_identified_by_profile_id_fkey(id, first_name, last_name),
  compliance_item:resident_compliance_items(id, status, due_date),
  incident:incidents(id, status, severity)
`;

function invalidateChangeEvents(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-change-events"] });
  queryClient.invalidateQueries({ queryKey: ["resident_compliance_items"] });
  queryClient.invalidateQueries({ queryKey: ["resident_compliance_items_all"] });
  queryClient.invalidateQueries({ queryKey: ["incidents"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
  queryClient.invalidateQueries({ queryKey: ["service-task-alerts"] });
}

export function useChangeEventResidentOptions() {
  return useQuery({
    queryKey: ["resident-change-events", "resident-options"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_change_event_resident_options" as never);
      if (error) throw error;
      return data as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        room: string | null;
        facility_id: string;
      }[];
    },
  });
}

export function useListResidentChangeEvents(filters: {
  organizationId?: string;
  facilityId?: string;
  residentId?: string;
  status?: string;
  assignedProfileId?: string;
  category?: string;
} = {}) {
  return useQuery({
    queryKey: ["resident-change-events", "list", filters],
    queryFn: async () => {
      let query = supabase
        .from("resident_change_events")
        .select(CHANGE_EVENT_SELECT)
        .order("follow_up_due_at");
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.residentId) query = query.eq("resident_id", filters.residentId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.assignedProfileId) query = query.eq("assigned_profile_id", filters.assignedProfileId);
      if (filters.category) query = query.eq("category", filters.category);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ResidentChangeEventWithRelations[];
    },
  });
}

export function useGetResidentChangeEvent(id?: string) {
  return useQuery({
    queryKey: ["resident-change-events", "detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_change_events")
        .select(CHANGE_EVENT_SELECT)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as ResidentChangeEventWithRelations;
    },
    enabled: !!id,
  });
}

export function useResidentChangeEventActivity(id?: string) {
  return useQuery({
    queryKey: ["resident-change-events", "activity", id],
    queryFn: async () => {
      const [monitoring, followUps, history] = await Promise.all([
        supabase
          .from("resident_change_monitoring_entries")
          .select("*, recorder:profiles!resident_change_monitoring_entries_recorded_by_profile_id_fkey(id, first_name, last_name)")
          .eq("event_id", id!)
          .order("observed_at", { ascending: false }),
        supabase
          .from("resident_change_follow_ups")
          .select(`
            *,
            assigned:profiles!resident_change_follow_ups_assigned_profile_id_fkey(id, first_name, last_name),
            completed_by:profiles!resident_change_follow_ups_completed_by_profile_id_fkey(id, first_name, last_name)
          `)
          .eq("event_id", id!)
          .order("due_at"),
        supabase
          .from("resident_change_event_history")
          .select("*, actor:profiles!resident_change_event_history_actor_profile_id_fkey(id, first_name, last_name)")
          .eq("event_id", id!)
          .order("occurred_at", { ascending: false }),
      ]);
      const firstError = [monitoring, followUps, history].find(result => result.error)?.error;
      if (firstError) throw firstError;
      return {
        monitoring: (monitoring.data ?? []) as unknown as ChangeEventMonitoringWithRecorder[],
        followUps: (followUps.data ?? []) as unknown as ChangeEventFollowUpWithAssignee[],
        history: (history.data ?? []) as unknown as ChangeEventHistoryWithActor[],
      };
    },
    enabled: !!id,
  });
}

export interface CreateResidentChangeEventInput {
  residentId: string;
  category: string;
  identifiedAt: string;
  immediateObservations: string;
  immediateActionTaken: string;
  providerNotificationStatus: string;
  designatedPersonNotificationStatus: string;
  emergencyTransfer: boolean;
  emergencyTransferDestination?: string | null;
  monitoringInstructions?: string | null;
  monitoringFrequency?: string | null;
  monitoringDurationHours?: number | null;
  assignedProfileId?: string | null;
  followUpDueAt: string;
  incidentDecision: string;
  reassessmentRequired: boolean;
  supportPlanRevisionRequired: boolean;
  sourceServiceAlertId?: string | null;
}

export function useCreateResidentChangeEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateResidentChangeEventInput) => {
      const { data, error } = await supabase.rpc("create_resident_change_event" as never, {
        p_resident_id: input.residentId,
        p_category: input.category,
        p_identified_at: input.identifiedAt,
        p_immediate_observations: input.immediateObservations,
        p_immediate_action_taken: input.immediateActionTaken,
        p_provider_notification_status: input.providerNotificationStatus,
        p_designated_person_notification_status: input.designatedPersonNotificationStatus,
        p_emergency_transfer: input.emergencyTransfer,
        p_emergency_transfer_destination: input.emergencyTransferDestination ?? null,
        p_monitoring_instructions: input.monitoringInstructions ?? null,
        p_monitoring_frequency: input.monitoringFrequency ?? null,
        p_monitoring_duration_hours: input.monitoringDurationHours ?? null,
        p_assigned_profile_id: input.assignedProfileId ?? null,
        p_follow_up_due_at: input.followUpDueAt,
        p_incident_decision: input.incidentDecision,
        p_reassessment_required: input.reassessmentRequired,
        p_support_plan_revision_required: input.supportPlanRevisionRequired,
        p_source_service_alert_id: input.sourceServiceAlertId ?? null,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateChangeEvents(queryClient),
  });
}

export function useRecordChangeEventNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      party: string;
      status: string;
      notifiedAt?: string | null;
      method?: string;
      contact?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_change_event_notification" as never, {
        p_event_id: input.eventId,
        p_party: input.party,
        p_status: input.status,
        p_notified_at: input.notifiedAt ?? null,
        p_method: input.method ?? "",
        p_contact: input.contact ?? "",
        p_notes: input.notes ?? "",
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateChangeEvents(queryClient),
  });
}

export function useAddChangeEventMonitoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      observedAt: string;
      observations: string;
      actionTaken?: string;
      supervisorNotified: boolean;
    }) => {
      const { data, error } = await supabase.rpc("add_change_event_monitoring", {
        p_event_id: input.eventId,
        p_observed_at: input.observedAt,
        p_observations: input.observations,
        p_action_taken: input.actionTaken,
        p_supervisor_notified: input.supervisorNotified,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateChangeEvents(queryClient),
  });
}

export function useCompleteChangeEventFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      followUpId: string;
      result: string;
      nextFollowUpDueAt?: string | null;
      nextAssignedProfileId?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("complete_change_event_follow_up", {
        p_follow_up_id: input.followUpId,
        p_result: input.result,
        p_next_follow_up_due_at: input.nextFollowUpDueAt ?? undefined,
        p_next_assigned_profile_id: input.nextAssignedProfileId ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateChangeEvents(queryClient),
  });
}

export function useCloseResidentChangeEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, summary }: { eventId: string; summary: string }) => {
      const { data, error } = await supabase.rpc("close_resident_change_event", {
        p_event_id: eventId,
        p_final_review_summary: summary,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateChangeEvents(queryClient),
  });
}
