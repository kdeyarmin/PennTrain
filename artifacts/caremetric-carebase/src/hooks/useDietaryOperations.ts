import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type DietaryProfile = Tables<"resident_dietary_profiles">;
export type MenuCycle = Tables<"dietary_menu_cycles">;
export type MenuEntry = Tables<"dietary_menu_entries">;
export type MealRecord = Tables<"resident_meal_records">;
export type HydrationRound = Tables<"resident_hydration_rounds">;
export type WeightAssignment = Tables<"weight_monitoring_assignments">;
export type WeightReading = Tables<"resident_weight_readings">;
export type NutritionReview = Tables<"nutrition_risk_reviews">;
export type FoodSafetyControl = Tables<"food_safety_control_points">;
export type FoodSafetyLog = Tables<"food_safety_logs">;
export type FoodServiceQualification = Tables<"food_service_employee_qualifications">;

export interface MenuCycleWithEntries extends MenuCycle {
  entries: MenuEntry[];
}

export interface FoodSafetyLogWithControl extends FoodSafetyLog {
  control: Pick<FoodSafetyControl, "id" | "label" | "location_detail" | "control_type" | "measurement_unit"> | null;
}

export interface QualificationWithEmployee extends FoodServiceQualification {
  employee: { id: string; first_name: string; last_name: string; job_title: string | null } | null;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["dietary-operations"] });
  queryClient.invalidateQueries({ queryKey: ["residents"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
  queryClient.invalidateQueries({ queryKey: ["qapi"] });
}

export function useDietaryOperations(facilityId?: string, residentId?: string) {
  return useQuery({
    queryKey: ["dietary-operations", facilityId, residentId],
    queryFn: async () => {
      const resident = residentId ?? "00000000-0000-0000-0000-000000000000";
      const [profiles, menus, meals, hydration, assignments, readings, reviews, controls, logs, qualifications] = await Promise.all([
        supabase.from("resident_dietary_profiles").select("*").eq("resident_id", resident).maybeSingle(),
        supabase.from("dietary_menu_cycles").select("*,entries:dietary_menu_entries(*)").eq("facility_id", facilityId!).order("starts_on", { ascending: false }),
        supabase.from("resident_meal_records").select("*").eq("resident_id", resident).order("served_at", { ascending: false }).limit(30),
        supabase.from("resident_hydration_rounds").select("*").eq("resident_id", resident).order("scheduled_at", { ascending: false }).limit(30),
        supabase.from("weight_monitoring_assignments").select("*").eq("resident_id", resident).order("created_at", { ascending: false }),
        supabase.from("resident_weight_readings").select("*").eq("resident_id", resident).order("measured_at", { ascending: false }).limit(30),
        supabase.from("nutrition_risk_reviews").select("*").eq("resident_id", resident).order("reviewed_at", { ascending: false }).limit(30),
        supabase.from("food_safety_control_points").select("*").eq("facility_id", facilityId!).order("label"),
        supabase.from("food_safety_logs").select("*,control:food_safety_control_points(id,label,location_detail,control_type,measurement_unit)").eq("facility_id", facilityId!).order("observed_at", { ascending: false }).limit(50),
        supabase.from("food_service_employee_qualifications").select("*,employee:employees(id,first_name,last_name,job_title)").eq("facility_id", facilityId!).order("updated_at", { ascending: false }),
      ]);
      const error = [profiles, menus, meals, hydration, assignments, readings, reviews, controls, logs, qualifications].find((result) => result.error)?.error;
      if (error) throw error;
      return {
        profile: profiles.data as DietaryProfile | null,
        menus: (menus.data ?? []) as unknown as MenuCycleWithEntries[],
        meals: (meals.data ?? []) as MealRecord[],
        hydration: (hydration.data ?? []) as HydrationRound[],
        assignments: (assignments.data ?? []) as WeightAssignment[],
        readings: (readings.data ?? []) as WeightReading[],
        reviews: (reviews.data ?? []) as NutritionReview[],
        controls: (controls.data ?? []) as FoodSafetyControl[],
        logs: (logs.data ?? []) as unknown as FoodSafetyLogWithControl[],
        qualifications: (qualifications.data ?? []) as unknown as QualificationWithEmployee[],
      };
    },
    enabled: !!facilityId,
  });
}

function rpcMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) {
  return function useRpcMutation() {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn, onSuccess: () => invalidate(queryClient) });
  };
}

export const useSaveDietaryProfile = rpcMutation(async (input: { residentId: string; profile: Json; changeReason: string }) => {
  const { data, error } = await supabase.rpc("upsert_resident_dietary_profile", {
    p_resident_id: input.residentId,
    p_profile: input.profile,
    p_change_reason: input.changeReason,
  });
  if (error) throw error;
  return data;
});

export const useCreateMenuCycle = rpcMutation(async (input: { facilityId: string; name: string; startsOn: string; cycleLengthDays: number; status: string; entries: Json }) => {
  const { data, error } = await supabase.rpc("create_dietary_menu_cycle", {
    p_facility_id: input.facilityId,
    p_name: input.name,
    p_starts_on: input.startsOn,
    p_cycle_length_days: input.cycleLengthDays,
    p_status: input.status,
    p_entries: input.entries,
  });
  if (error) throw error;
  return data;
});

export const useRecordMeal = rpcMutation(async (input: { residentId: string; servedAt: string; mealPeriod: string; attendance: string; outcome: string; intakePercent?: number; substitution?: string; assistance?: string; exceptionReason?: string; menuEntryId?: string }) => {
  const { data, error } = await supabase.rpc("record_resident_meal" as never, {
    p_resident_id: input.residentId,
    p_served_at: input.servedAt,
    p_meal_period: input.mealPeriod,
    p_attendance: input.attendance,
    p_outcome: input.outcome,
    p_intake_percent: input.intakePercent ?? null,
    p_substitution: input.substitution ?? null,
    p_assistance_provided: input.assistance ?? null,
    p_exception_reason: input.exceptionReason ?? null,
    p_menu_entry_id: input.menuEntryId ?? null,
  } as never);
  if (error) throw error;
  return data;
});

export const useRecordHydration = rpcMutation(async (input: { residentId: string; scheduledAt: string; offeredMl: number; consumedMl: number; outcome: string; exceptionRecorded: boolean; exceptionReason?: string }) => {
  const { data, error } = await supabase.rpc("record_resident_hydration_round" as never, {
    p_resident_id: input.residentId,
    p_scheduled_at: input.scheduledAt,
    p_offered_ml: input.offeredMl,
    p_consumed_ml: input.consumedMl,
    p_outcome: input.outcome,
    p_exception_recorded: input.exceptionRecorded,
    p_exception_reason: input.exceptionReason ?? null,
  } as never);
  if (error) throw error;
  return data;
});

export const useAssignWeightMonitoring = rpcMutation(async (input: { residentId: string; frequency: string; nextDueDate: string; thresholdLbs: number; assignedProfileId?: string; reason: string }) => {
  const { data, error } = await supabase.rpc("assign_resident_weight_monitoring" as never, {
    p_resident_id: input.residentId,
    p_frequency: input.frequency,
    p_next_due_date: input.nextDueDate,
    p_change_threshold_lbs: input.thresholdLbs,
    p_assigned_profile_id: input.assignedProfileId ?? null,
    p_reason: input.reason,
  } as never);
  if (error) throw error;
  return data;
});

export const useRecordWeight = rpcMutation(async (input: { assignmentId: string; measuredAt: string; weightLbs: number; notes?: string }) => {
  const { data, error } = await supabase.rpc("record_resident_weight" as never, {
    p_assignment_id: input.assignmentId,
    p_measured_at: input.measuredAt,
    p_weight_lbs: input.weightLbs,
    p_notes: input.notes ?? null,
  } as never);
  if (error) throw error;
  return data;
});

export const useRecordNutritionReview = rpcMutation(async (input: { residentId: string; reviewedAt: string; riskLevel: string; findings: string; actionPlan?: string; referralType?: string; referralRecipient?: string; referralStatus?: string; followUpDueDate?: string }) => {
  const { data, error } = await supabase.rpc("record_nutrition_risk_review" as never, {
    p_resident_id: input.residentId,
    p_reviewed_at: input.reviewedAt,
    p_risk_level: input.riskLevel,
    p_findings: input.findings,
    p_action_plan: input.actionPlan ?? null,
    p_referral_type: input.referralType ?? null,
    p_referral_recipient: input.referralRecipient ?? null,
    p_referral_status: input.referralStatus ?? null,
    p_follow_up_due_date: input.followUpDueDate ?? null,
  } as never);
  if (error) throw error;
  return data;
});

export const useSaveFoodSafetyControl = rpcMutation(async (input: { facilityId: string; controlId?: string; controlType: string; label: string; location: string; unit: string; minimum?: number; maximum?: number; frequency: string; active: boolean }) => {
  const { data, error } = await supabase.rpc("upsert_food_safety_control_point" as never, {
    p_facility_id: input.facilityId,
    p_control_id: input.controlId ?? null,
    p_control_type: input.controlType,
    p_label: input.label,
    p_location_detail: input.location,
    p_measurement_unit: input.unit,
    p_minimum_value: input.minimum ?? null,
    p_maximum_value: input.maximum ?? null,
    p_frequency: input.frequency,
    p_active: input.active,
  } as never);
  if (error) throw error;
  return data;
});

export const useRecordFoodSafetyLog = rpcMutation(async (input: { controlPointId: string; observedAt: string; observedValue?: number; checklist: Json; result: string; observation?: string; immediateAction?: string; equipmentReference?: string }) => {
  const { data, error } = await supabase.rpc("record_food_safety_log" as never, {
    p_control_point_id: input.controlPointId,
    p_observed_at: input.observedAt,
    p_observed_value: input.observedValue ?? null,
    p_checklist: input.checklist,
    p_result: input.result,
    p_observation: input.observation ?? null,
    p_immediate_action: input.immediateAction ?? null,
    p_equipment_reference: input.equipmentReference ?? null,
  } as never);
  if (error) throw error;
  return data;
});

export const useVerifyFoodSafetyLog = rpcMutation(async (input: { logId: string; correctiveAction: string; correctedAt: string; verificationNotes: string }) => {
  const { data, error } = await supabase.rpc("verify_food_safety_log", {
    p_log_id: input.logId,
    p_corrective_action: input.correctiveAction,
    p_corrected_at: input.correctedAt,
    p_verification_notes: input.verificationNotes,
  });
  if (error) throw error;
  return data;
});

export const useSaveFoodServiceQualification = rpcMutation(async (input: { employeeId: string; qualificationType: string; qualificationLabel?: string; issuedOn?: string; expiresOn?: string; status: string; issuingAuthority?: string; evidenceReference?: string; notes?: string }) => {
  const { data, error } = await supabase.rpc("upsert_food_service_qualification" as never, {
    p_employee_id: input.employeeId,
    p_qualification_type: input.qualificationType,
    p_qualification_label: input.qualificationLabel ?? null,
    p_issued_on: input.issuedOn ?? null,
    p_expires_on: input.expiresOn ?? null,
    p_status: input.status,
    p_issuing_authority: input.issuingAuthority ?? null,
    p_evidence_reference: input.evidenceReference ?? null,
    p_notes: input.notes ?? null,
  } as never);
  if (error) throw error;
  return data;
});
