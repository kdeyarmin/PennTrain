import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert } from "@/lib/database.types";

export type ServiceWorkloadProfile = Tables<"service_workload_profiles">;
export type ServiceWorkloadProfileInsert = TablesInsert<"service_workload_profiles">;

export interface EligibilityCandidate {
  employeeId: string;
  employeeName: string;
  jobTitle: string | null;
  outcome: "eligible" | "warning" | "blocked";
  hardBlocks: string[];
  warnings: string[];
  appliedOverrideIds: string[];
  sourceSnapshot: Record<string, unknown>;
  sourceChecksumSha256: string;
}

export interface CoverageRow {
  shift_date: string;
  workload_profile_id: string;
  unit_id: string | null;
  unit_name: string;
  shift_definition_id: string;
  shift_name: string;
  minimum_staff: number;
  minimum_medication_qualified_staff: number;
  minimum_insulin_qualified_staff: number;
  minimum_first_aid_cpr_staff: number;
  minimum_trainer_supervisor_staff: number;
  secured_unit_coverage_required: boolean;
  escort_reserve_staff: number;
  scheduled_staff: number;
  medication_qualified_staff: number;
  insulin_qualified_staff: number;
  first_aid_cpr_staff: number;
  trainer_supervisor_staff: number;
}

export interface ScheduleServiceWorkload {
  activeResidents: number;
  securedUnitResidents: number;
  supportPlanServices: number;
  twoPersonTransfers: number;
  escorts: number;
  safetyChecks: number;
  appointmentTransportationDemand: number;
  coverageGapCount: number;
  coverageRows: CoverageRow[];
}

export function usePreviewShiftAssignmentCandidates(params: {
  scheduleId?: string;
  shiftDate?: string;
  shiftDefinitionId?: string;
  unitId?: string | null;
}) {
  return useQuery({
    queryKey: ["shift-eligibility-preview", params],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_shift_assignment_candidates", {
        p_schedule_id: params.scheduleId!,
        p_shift_date: params.shiftDate!,
        p_shift_definition_id: params.shiftDefinitionId!,
        p_unit_id: params.unitId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as EligibilityCandidate[];
    },
    enabled: !!params.scheduleId && !!params.shiftDate && !!params.shiftDefinitionId,
  });
}

export function useCreateScheduleEligibilityOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      employeeId: string;
      facilityId: string;
      blockCode: string;
      scopeType: "facility" | "shift" | "class";
      scopeId: string | null;
      reason: string;
      authorityReference: string;
      expiresAt: string;
    }) => {
      const { data, error } = await supabase.rpc("create_schedule_eligibility_override", {
        p_employee_id: payload.employeeId,
        p_facility_id: payload.facilityId,
        p_block_code: payload.blockCode,
        p_scope_type: payload.scopeType,
        p_scope_id: payload.scopeId ?? payload.facilityId,
        p_reason: payload.reason,
        p_authority_reference: payload.authorityReference,
        p_expires_at: payload.expiresAt,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shift-eligibility-preview"] }),
  });
}

export function useListServiceWorkloadProfiles(facilityId?: string) {
  return useQuery({
    queryKey: ["service-workload-profiles", facilityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_workload_profiles")
        .select("*")
        .eq("facility_id", facilityId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!facilityId,
  });
}

export function useSaveServiceWorkloadProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ServiceWorkloadProfileInsert) => {
      const { data, error } = await supabase
        .from("service_workload_profiles")
        .upsert(payload, { onConflict: "facility_id,unit_id,shift_definition_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-workload-profiles"] }),
  });
}

export function useDeleteServiceWorkloadProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_workload_profiles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-workload-profiles"] }),
  });
}

export function useScheduleServiceWorkload(scheduleId?: string) {
  return useQuery({
    queryKey: ["schedule-service-workload", scheduleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_schedule_service_workload", { p_schedule_id: scheduleId! });
      if (error) throw error;
      return data as unknown as ScheduleServiceWorkload;
    },
    enabled: !!scheduleId,
  });
}
