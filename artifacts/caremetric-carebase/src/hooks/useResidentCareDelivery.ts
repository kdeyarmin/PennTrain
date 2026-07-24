import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export interface ResidentCareAnalyticsMetric {
  numerator?: number;
  denominator?: number;
  count?: number;
  overdue?: number;
  due?: number;
  definition: string;
}

export interface ResidentCareAnalytics {
  scope: {
    organizationId: string;
    facilityId: string;
    from: string;
    through: string;
    dateBasis: string;
  };
  serviceCompletion: ResidentCareAnalyticsMetric;
  serviceExceptions: ResidentCareAnalyticsMetric;
  repeatedRefusals: ResidentCareAnalyticsMetric;
  changeOfConditionFrequency: ResidentCareAnalyticsMetric;
  planReviewTimeliness: ResidentCareAnalyticsMetric;
  dmeInspectionStatus: ResidentCareAnalyticsMetric;
  hospitalReturnsOpenFollowUp: ResidentCareAnalyticsMetric;
}

function invalidateResidentCare(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-care-delivery"] });
  queryClient.invalidateQueries({ queryKey: ["resident-service-tasks"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
  queryClient.invalidateQueries({ queryKey: ["daily-operations"] });
}

export function useResidentCareAnalytics(filters: { facilityId?: string; from: string; through: string }) {
  return useQuery({
    queryKey: ["resident-care-delivery", "analytics", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_resident_care_delivery_analytics" as never, {
        p_facility_id: filters.facilityId,
        p_from: filters.from,
        p_through: filters.through,
      } as never);
      if (error) throw error;
      return data as unknown as ResidentCareAnalytics;
    },
    enabled: Boolean(filters.facilityId),
    staleTime: 60_000,
  });
}

export function useGenerateSupportPlanProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assessmentFormId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("generate_support_plan_proposal" as never, {
        p_assessment_form_id: input.assessmentFormId,
        p_reason: input.reason ?? "Assessment change requires support-plan review",
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateResidentCare(queryClient),
  });
}

export function useCreateSupportPlanDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { residentId: string; assessmentFormId?: string; priorPlanId?: string }) => {
      const { data, error } = await supabase.rpc("create_support_plan_draft" as never, {
        p_resident_id: input.residentId,
        p_assessment_form_id: input.assessmentFormId ?? null,
        p_prior_plan_id: input.priorPlanId ?? null,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateResidentCare(queryClient),
  });
}

export type ResidentSupportPlan = Tables<"resident_support_plans">;
export type SupportPlanProposal = Tables<"support_plan_proposals">;

function invalidateSupportPlans(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-support-plans"] });
  queryClient.invalidateQueries({ queryKey: ["support-plan-proposals"] });
}

export function useResidentSupportPlans(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident-support-plans", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_support_plans")
        .select("*")
        .eq("resident_id", residentId!)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data as ResidentSupportPlan[];
    },
  });
}

export function useResidentSupportPlanProposals(residentId: string | undefined) {
  return useQuery({
    queryKey: ["support-plan-proposals", residentId],
    enabled: !!residentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_plan_proposals")
        .select("*")
        .eq("resident_id", residentId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SupportPlanProposal[];
    },
  });
}

export function useSubmitSupportPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const { data, error } = await supabase.rpc("submit_support_plan_for_review" as never, { p_plan_id: planId } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => invalidateSupportPlans(queryClient),
  });
}

export function useApproveSupportPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: string; effectiveDate: string; reviewDueDate: string; staffSignature?: Json }) => {
      const { data, error } = await supabase.rpc("approve_support_plan" as never, {
        p_plan_id: input.planId,
        p_effective_date: input.effectiveDate,
        p_review_due_date: input.reviewDueDate,
        p_staff_signature: input.staffSignature ?? {},
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      invalidateSupportPlans(queryClient);
      invalidateResidentCare(queryClient);
    },
  });
}

export function useReviewSupportPlanProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { proposalId: string; decision: "accepted" | "modified" | "rejected"; rationale: string; modifiedProposal?: Json }) => {
      const { data, error } = await supabase.rpc("review_support_plan_proposal" as never, {
        p_proposal_id: input.proposalId,
        p_decision: input.decision,
        p_rationale: input.rationale,
        p_modified_proposal: input.modifiedProposal ?? null,
      } as never);
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => invalidateSupportPlans(queryClient),
  });
}

export function useRegisterResidentDmeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      facilityId: string;
      residentId?: string;
      equipmentType: string;
      ownership?: string;
      location?: string;
      vendor?: string;
      serialAssetNumber?: string;
      staffInstructions?: string;
      inspectionFrequencyDays?: number;
      preventiveMaintenanceRequired?: boolean;
      replacementDueDate?: string;
      cleaningRequired?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("register_resident_dme_item" as never, {
        p_facility_id: input.facilityId,
        p_resident_id: input.residentId ?? null,
        p_equipment_type: input.equipmentType,
        p_ownership: input.ownership ?? "facility",
        p_location: input.location ?? null,
        p_vendor: input.vendor ?? null,
        p_serial_asset_number: input.serialAssetNumber ?? null,
        p_staff_instructions: input.staffInstructions ?? null,
        p_inspection_frequency_days: input.inspectionFrequencyDays ?? null,
        p_preventive_maintenance_required: input.preventiveMaintenanceRequired ?? false,
        p_replacement_due_date: input.replacementDueDate ?? null,
        p_cleaning_required: input.cleaningRequired ?? false,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateResidentCare(queryClient),
  });
}

export function useScheduleResidentAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      appointmentType: string;
      location: string;
      startsAt: string;
      expectedReturnAt?: string;
      providerName?: string;
      transportationProvider?: string;
      vehicleIdentifier?: string;
      driverEmployeeId?: string;
      escortEmployeeId?: string;
      pickupAt?: string;
      documentsRequired?: string[];
      equipmentRequired?: string[];
      preparationChecklist?: Json;
    }) => {
      const { data, error } = await supabase.rpc("schedule_resident_appointment" as never, {
        p_resident_id: input.residentId,
        p_appointment_type: input.appointmentType,
        p_location: input.location,
        p_starts_at: input.startsAt,
        p_expected_return_at: input.expectedReturnAt ?? null,
        p_provider_name: input.providerName ?? null,
        p_transportation_provider: input.transportationProvider ?? null,
        p_vehicle_identifier: input.vehicleIdentifier ?? null,
        p_driver_employee_id: input.driverEmployeeId ?? null,
        p_escort_employee_id: input.escortEmployeeId ?? null,
        p_pickup_at: input.pickupAt ?? null,
        p_documents_required: input.documentsRequired ?? [],
        p_equipment_required: input.equipmentRequired ?? [],
        p_preparation_checklist: input.preparationChecklist ?? [],
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateResidentCare(queryClient),
  });
}

export function useStartHospitalTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      residentId: string;
      reason: string;
      destination: string;
      transferTime: string;
      transportMethod: string;
      expectedReturnAt?: string;
      linkedChangeEventId?: string;
      documentsSent?: string[];
      equipmentSent?: string[];
      notifications?: Json;
      belongings?: Json;
    }) => {
      const { data, error } = await supabase.rpc("start_hospital_transfer" as never, {
        p_resident_id: input.residentId,
        p_reason: input.reason,
        p_destination: input.destination,
        p_transfer_time: input.transferTime,
        p_transport_method: input.transportMethod,
        p_expected_return_at: input.expectedReturnAt ?? null,
        p_linked_change_event_id: input.linkedChangeEventId ?? null,
        p_documents_sent: input.documentsSent ?? [],
        p_equipment_sent: input.equipmentSent ?? [],
        p_notifications: input.notifications ?? [],
        p_belongings: input.belongings ?? {},
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateResidentCare(queryClient),
  });
}
