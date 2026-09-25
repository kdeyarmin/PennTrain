import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { parseTrainingEnrollmentPage, TRAINING_REPORT_EXPORT_LIMIT_MESSAGE, type TrainingEnrollmentFilters } from "@/lib/trainingEnrollmentReport";

export async function readTrainingEnrollmentReport(filters: TrainingEnrollmentFilters, offset = 0, limit = 50) {
  const { data, error } = await supabase.rpc("get_training_progress_report", {
    p_organization_id: filters.organizationId, p_facility_id: filters.facilityId,
    p_course_search: filters.courseSearch, p_status: filters.status, p_date_basis: filters.dateBasis,
    p_date_from: filters.dateFrom || undefined, p_date_through: filters.dateThrough || undefined,
    p_limit: limit, p_offset: offset, p_employee_id: filters.employeeId || undefined, p_plan_id: filters.planId || undefined,
    p_purpose: filters.purpose || "all", p_department: filters.department || "", p_training_year: filters.trainingYear, p_deadline: filters.deadline || "all",
  });
  if (error) {
    // PostgREST errors are plain response objects; make the actionable bound visible
    // even if records grew past the limit after the on-screen report was loaded.
    if (error.code === "54000") throw new Error(TRAINING_REPORT_EXPORT_LIMIT_MESSAGE);
    throw error;
  }
  return parseTrainingEnrollmentPage(data);
}

export function useTrainingEnrollmentReport(filters: TrainingEnrollmentFilters, offset: number, enabled = true) {
  return useQuery({
    queryKey: ["training-enrollment-report", filters, offset],
    queryFn: () => readTrainingEnrollmentReport(filters, offset),
    // Returning from assignment or completion actions must show their latest totals.
    staleTime: 0,
    enabled: enabled && !!filters.organizationId,
  });
}

/** Owner selector must not silently lose customers beyond the PostgREST response cap. */
export function useTrainingReportOrganizations(enabled: boolean) {
  return useQuery({
    queryKey: ["organizations", "training-report-picker"], enabled,
    queryFn: async () => {
      const rows: { id: string; name: string }[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("organizations").select("id,name")
          .order("name").order("id").range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      return rows;
    },
  });
}
