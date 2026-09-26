import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import type { TrainingWorkspace } from "@/lib/trainingWorkspace";
import { currentTrainingPolicy, type TrainingPolicy, paDay } from "@/lib/trainingWorkspace";

export function useTrainingYearPolicy(facilityId: string | undefined) {
  return useQuery({ queryKey: ["training-year-policy", facilityId], enabled: !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_facility_policies").select("*").eq("facility_id", facilityId!);
      if (error) throw error;
      return currentTrainingPolicy((data ?? []) as TrainingPolicy[], paDay()) ?? { id: "default", effective_from: "2000-01-01",
        year_basis: "fixed", year_start: "01-01", administrator_year_basis: "fixed", administrator_year_start: "01-01", policy_reference: "Calendar year default" } as TrainingPolicy;
    } });
}

export function useTrainingWorkspace(facilityId: string) {
  return useQuery({
    queryKey: ["training-workspace", facilityId], enabled: !!facilityId,
    queryFn: async () => {
      const result: TrainingWorkspace = { policies: [], profiles: [], events: [], shifts: [], plans: [], generated_at: "" };
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.rpc("get_training_workspace", { p_facility_id: facilityId, p_limit: 500, p_offset: offset });
        if (error) throw error;
        const page = data as unknown as TrainingWorkspace;
        if (!page || ![page.profiles, page.events, page.shifts, page.plans, page.policies].every(Array.isArray)) throw new Error("Incomplete training response; retry before exporting.");
        if (!offset) { result.policies = page.policies; result.generated_at = page.generated_at; result.staff_policy = page.staff_policy; }
        result.regulatory_profiles = [...(result.regulatory_profiles ?? []), ...(page.regulatory_profiles ?? [])];
        result.annual_summaries = { ...result.annual_summaries, ...page.annual_summaries };
        result.profiles.push(...page.profiles); result.events.push(...page.events);
        result.shifts.push(...page.shifts); result.plans.push(...page.plans);
        if ([page.profiles, page.events, page.shifts, page.plans, page.regulatory_profiles ?? [], Object.keys(page.annual_summaries ?? {})].every(rows => rows.length < 500)) break;
      }
      result.events.sort((a, b) => a.completed_on.localeCompare(b.completed_on) || a.id.localeCompare(b.id));
      return result;
    },
  });
}

export function useSaveTrainingWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: string; facilityId: string; employeeId: string | null; data: Json }) => {
      const { data, error } = await supabase.rpc("save_training_workspace_item", {
        p_kind: input.kind, p_facility_id: input.facilityId, p_employee_id: input.employeeId!, p_data: input.data,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: ["training-workspace"] });
      void client.invalidateQueries({ queryKey: ["training-year-policy"] });
      void client.invalidateQueries({ queryKey: ["staff-training-summary"] });
      void client.invalidateQueries({ queryKey: ["training_hour_buckets"] });
      void client.invalidateQueries({ queryKey: ["schedule-service-workload"] });
      if (input.kind === "profile") {
        void client.invalidateQueries({ queryKey: ["employee_onboarding_items", input.employeeId] });
      }
      if (input.kind === "lifecycle") {
        void client.invalidateQueries({ queryKey: ["employees"] });
        void client.invalidateQueries({ queryKey: ["course_assignments"] });
        void client.invalidateQueries({ queryKey: ["profiles"] });
      }
    },
  });
}
