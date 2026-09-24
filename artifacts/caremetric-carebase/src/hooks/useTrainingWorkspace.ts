import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import type { TrainingWorkspace } from "@/lib/trainingWorkspace";

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
        if (!offset) { result.policies = page.policies; result.generated_at = page.generated_at; }
        result.profiles.push(...page.profiles); result.events.push(...page.events);
        result.shifts.push(...page.shifts); result.plans.push(...page.plans);
        if ([page.profiles, page.events, page.shifts, page.plans].every(rows => rows.length < 500)) break;
      }
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
    onSuccess: () => client.invalidateQueries({ queryKey: ["training-workspace"] }),
  });
}
