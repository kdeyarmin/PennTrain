import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import type { TrainingWorkspace } from "@/lib/trainingWorkspace";

export function useTrainingWorkspace(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: ["training-workspace", facilityId], enabled: !!facilityId && enabled,
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
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.rpc("get_training_completion_evidence", { p_facility_id: facilityId, p_limit: 500, p_offset: offset });
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error("Online completion evidence is unavailable.");
        result.events.push(...data as unknown as TrainingWorkspace["events"]);
        if (data.length < 500) break;
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
      if (input.kind === "lifecycle") {
        void client.invalidateQueries({ queryKey: ["employees"] });
        void client.invalidateQueries({ queryKey: ["course_assignments"] });
        void client.invalidateQueries({ queryKey: ["profiles"] });
      }
    },
  });
}
