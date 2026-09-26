import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";

export interface StaffRegulatoryPolicy {
  medication_course_years: number | null; trainer_recertification_years: number;
  annual_grace_days: number; alf_ojt_allowed: boolean; alf_transfer_months: number | null;
  staff_tb_required: boolean; clearance_renewal_years: number | null;
  pch_cpr_before_care: boolean; pch_dementia_30day: boolean; policy_reference: string;
  waking_start?: string; waking_end?: string;
}
export const DEFAULT_STAFF_POLICY: StaffRegulatoryPolicy = {
  medication_course_years: null, trainer_recertification_years: 3, annual_grace_days: 15,
  alf_ojt_allowed: false, alf_transfer_months: 12, staff_tb_required: false, clearance_renewal_years: 5,
  pch_cpr_before_care: false, pch_dementia_30day: false,
  waking_start: "07:00", waking_end: "23:00",
  policy_reference: "DHS 2600/2800 RCG; conservative ALF OJT and transfer interpretation; five-year clearance renewal is facility policy.",
};
export interface EmployeeRegulatoryProfile {
  birth_date: string | null; education: string; role_category: string; education_evidence: string;
  medical_fitness_confirmed: boolean; licensed_professional_exemption: boolean; exemption_evidence: string;
  professional_exemption_valid_until: string | null;
  continuous_service_since: string | null; adl_competency_verified_on: string | null; adl_competency_evidence: string;
}
export interface OapsaDutyStatus {
  bar: string | null; reason: string; clearancesOnFile: boolean; pspExpiresOn: string | null;
  fbiExpiresOn: string | null; fbiRequired: boolean; requestsOnTime: boolean; expiresOn: string | null; daysRemaining: number;
}
export function useStaffRegulatoryPolicy(facilityId: string) {
  return useQuery({ queryKey: ["staff-regulatory-policy", facilityId], enabled: !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_regulatory_policies").select("*").eq("facility_id", facilityId).maybeSingle();
      if (error) throw error;
      return (data ?? DEFAULT_STAFF_POLICY) as StaffRegulatoryPolicy;
    } });
}
export function useEmployeeRegulatoryProfile(employeeId: string) {
  return useQuery({ queryKey: ["employee-regulatory-profile", employeeId], enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase.from("employee_regulatory_profiles").select("*").eq("employee_id", employeeId).maybeSingle();
      if (error) throw error;
      return data as EmployeeRegulatoryProfile | null;
    } });
}
export function useOapsaDutyStatuses(employeeIds: string[]) {
  const ids = [...employeeIds].sort();
  return useQuery({ queryKey: ["oapsa-duty-statuses", ids], enabled: ids.length > 0,
    queryFn: async () => {
      const results: Record<string, OapsaDutyStatus> = {};
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await supabase.rpc("get_oapsa_duty_statuses", { p_employee_ids: ids.slice(i, i + 500) });
        if (error) throw error;
        Object.assign(results, data);
      }
      return results;
    } });
}
export function useSaveStaffRegulatorySettings() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (input: { facilityId: string; employeeId?: string; data: Json }) => {
    const { data, error } = await supabase.rpc("save_staff_regulatory_settings", {
      p_facility_id: input.facilityId, p_employee_id: input.employeeId ?? null!, p_data: input.data,
    });
    if (error) throw error;
    return data;
  }, onSuccess: () => {
    for (const key of ["staff-regulatory-policy", "employee-regulatory-profile", "oapsa-duty-statuses", "training-workspace",
      "training_records", "employee_training_records", "training_hour_buckets", "staff-training-summary", "employee_credentials", "employee_onboarding_items", "schedule-service-workload"])
      void client.invalidateQueries({ queryKey: [key] });
  } });
}
