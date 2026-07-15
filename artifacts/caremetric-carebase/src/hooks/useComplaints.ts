import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type Complaint = Tables<"complaints">;
export type ComplaintInterview = Tables<"complaint_interviews">;
export type ComplaintMonitoringEntry = Tables<"complaint_monitoring_entries">;
export type ComplaintHistory = Tables<"complaint_history">;
export type ComplaintCorrectiveAction = Tables<"complaint_corrective_actions">;

export interface ComplaintWithRelations extends Complaint {
  facility: { id: string; name: string } | null;
  resident: { id: string; first_name: string; last_name: string; room: string | null } | null;
  investigator: { id: string; first_name: string; last_name: string } | null;
  incident: { id: string; incident_type: string; severity: string; status: string } | null;
}

export interface ComplaintActionWithWorkItem extends ComplaintCorrectiveAction {
  work_item: {
    id: string;
    title: string;
    state: string;
    priority: string;
    due_at: string;
    owner_profile_id: string | null;
  } | null;
}

const SELECT = `
  *,
  facility:facilities(id, name),
  resident:residents(id, first_name, last_name, room),
  investigator:profiles!complaints_assigned_investigator_profile_id_fkey(id, first_name, last_name),
  incident:incidents(id, incident_type, severity, status)
`;

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["complaints"] });
  queryClient.invalidateQueries({ queryKey: ["qapi"] });
  queryClient.invalidateQueries({ queryKey: ["incidents"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
}

export function useListComplaints(filters: {
  organizationId?: string;
  facilityId?: string;
  status?: string;
  category?: string;
} = {}) {
  return useQuery({
    queryKey: ["complaints", "list", filters],
    queryFn: async () => {
      let query = supabase.from("complaints").select(SELECT).order("date_received", { ascending: false });
      if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
      if (filters.facilityId) query = query.eq("facility_id", filters.facilityId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.category) query = query.eq("category", filters.category);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ComplaintWithRelations[];
    },
  });
}

export function useGetComplaint(id?: string) {
  return useQuery({
    queryKey: ["complaints", "detail", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("complaints").select(SELECT).eq("id", id!).single();
      if (error) throw error;
      return data as unknown as ComplaintWithRelations;
    },
    enabled: !!id,
  });
}

export function useComplaintActivity(id?: string) {
  return useQuery({
    queryKey: ["complaints", "activity", id],
    queryFn: async () => {
      const [interviews, monitoring, actions, history] = await Promise.all([
        supabase.from("complaint_interviews").select("*").eq("complaint_id", id!).order("interviewed_at", { ascending: false }),
        supabase.from("complaint_monitoring_entries").select("*").eq("complaint_id", id!).order("observed_at", { ascending: false }),
        supabase.from("complaint_corrective_actions").select("*,work_item:work_items(id,title,state,priority,due_at,owner_profile_id)").eq("complaint_id", id!),
        supabase.from("complaint_history").select("*").eq("complaint_id", id!).order("occurred_at", { ascending: false }),
      ]);
      const firstError = [interviews, monitoring, actions, history].find(result => result.error)?.error;
      if (firstError) throw firstError;
      return {
        interviews: (interviews.data ?? []) as ComplaintInterview[],
        monitoring: (monitoring.data ?? []) as ComplaintMonitoringEntry[],
        actions: (actions.data ?? []) as unknown as ComplaintActionWithWorkItem[],
        history: (history.data ?? []) as ComplaintHistory[],
      };
    },
    enabled: !!id,
  });
}

export interface CreateComplaintInput {
  facilityId: string;
  dateReceived: string;
  methodReceived: string;
  complainantType: string;
  complainantName?: string;
  complainantContact?: string;
  isAnonymous: boolean;
  residentId?: string;
  category: string;
  description: string;
  immediateRisk: string;
  immediateActionTaken?: string;
  reportableConcerns: string[];
  assignedInvestigatorProfileId?: string;
  linkedIncidentId?: string;
}

export function useCreateComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateComplaintInput) => {
      const { data, error } = await supabase.rpc("create_complaint" as never, {
        p_facility_id: input.facilityId,
        p_date_received: input.dateReceived,
        p_method_received: input.methodReceived,
        p_complainant_type: input.complainantType,
        p_complainant_name: input.complainantName ?? null,
        p_complainant_contact: input.complainantContact ?? null,
        p_is_anonymous: input.isAnonymous,
        p_resident_id: input.residentId ?? null,
        p_category: input.category,
        p_description: input.description,
        p_immediate_risk: input.immediateRisk,
        p_immediate_action_taken: input.immediateActionTaken ?? null,
        p_reportable_concerns: input.reportableConcerns,
        p_assigned_investigator_profile_id: input.assignedInvestigatorProfileId ?? null,
        p_linked_incident_id: input.linkedIncidentId ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export interface UpdateComplaintInput {
  id: string;
  status: string;
  acknowledgementDate?: string;
  assignedInvestigatorProfileId?: string;
  investigationNotes?: string;
  findings?: string;
  correctiveActionSummary?: string;
  writtenResponse?: string;
  writtenResponseDate?: string;
  appealRequestedAt?: string;
  appealOrReconsideration?: string;
  appealOutcome?: string;
  ombudsmanReferralAt?: string;
  ombudsmanReference?: string;
  nonretaliationMonitoringRequired: boolean;
  nonretaliationMonitoringUntil?: string;
  reason: string;
}

export function useUpdateComplaintCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateComplaintInput) => {
      const { data, error } = await supabase.rpc("update_complaint_case" as never, {
        p_complaint_id: input.id,
        p_status: input.status,
        p_acknowledgement_date: input.acknowledgementDate ?? null,
        p_assigned_investigator_profile_id: input.assignedInvestigatorProfileId ?? null,
        p_investigation_notes: input.investigationNotes ?? "",
        p_findings: input.findings ?? "",
        p_corrective_action_summary: input.correctiveActionSummary ?? "",
        p_written_response: input.writtenResponse ?? "",
        p_written_response_date: input.writtenResponseDate ?? null,
        p_appeal_requested_at: input.appealRequestedAt ?? null,
        p_appeal_or_reconsideration: input.appealOrReconsideration ?? "",
        p_appeal_outcome: input.appealOutcome ?? "",
        p_ombudsman_referral_at: input.ombudsmanReferralAt ?? null,
        p_ombudsman_reference: input.ombudsmanReference ?? "",
        p_nonretaliation_monitoring_required: input.nonretaliationMonitoringRequired,
        p_nonretaliation_monitoring_until: input.nonretaliationMonitoringUntil ?? null,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useAddComplaintInterview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { complaintId: string; interviewedAt: string; personName: string; relationship: string; notes: string }) => {
      const { data, error } = await supabase.rpc("add_complaint_interview", {
        p_complaint_id: input.complaintId,
        p_interviewed_at: input.interviewedAt,
        p_person_name: input.personName,
        p_relationship_to_case: input.relationship,
        p_notes: input.notes,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useAddComplaintCorrectiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { complaintId: string; title: string; description: string; ownerProfileId: string; priority: string; dueAt: string }) => {
      const { data, error } = await supabase.rpc("add_complaint_corrective_action", {
        p_complaint_id: input.complaintId,
        p_title: input.title,
        p_description: input.description,
        p_owner_profile_id: input.ownerProfileId,
        p_priority: input.priority,
        p_due_at: input.dueAt,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useAddComplaintMonitoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { complaintId: string; observedAt: string; observations: string; concern: boolean; actionTaken?: string }) => {
      const { data, error } = await supabase.rpc("add_complaint_monitoring_entry", {
        p_complaint_id: input.complaintId,
        p_observed_at: input.observedAt,
        p_observations: input.observations,
        p_retaliation_concern_identified: input.concern,
        p_action_taken: input.actionTaken ?? "",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function useComplaintTrends(facilityId?: string, from?: string, through?: string) {
  return useQuery({
    queryKey: ["complaints", "trends", facilityId, from, through],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_complaint_trends", {
        p_facility_id: facilityId!, p_from: from!, p_through: through!,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!facilityId && !!from && !!through,
  });
}
