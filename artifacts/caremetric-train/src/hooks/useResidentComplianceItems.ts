import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables, TablesUpdate } from "@/lib/database.types";

export type ResidentComplianceItem = Tables<"resident_compliance_items">;
export type ResidentComplianceItemUpdate = TablesUpdate<"resident_compliance_items">;

export function useListResidentComplianceItems(residentId: string | undefined) {
  return useQuery({
    queryKey: ["resident_compliance_items", residentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_compliance_items").select("*").eq("resident_id", residentId!).order("due_date");
      if (error) throw error;
      return data;
    },
    enabled: !!residentId,
  });
}

export function useUpdateResidentComplianceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: ResidentComplianceItemUpdate & { id: string }) => {
      const { data, error } = await supabase.from("resident_compliance_items").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["resident_compliance_items", data.resident_id] }),
  });
}

// Recurring items (renewal_interval_days set -- annual_reassessment, medical_evaluation) schedule
// their next cycle as a NEW row rather than overwriting this one, mirroring
// employee_training_records' own "successive renewal cycles accumulate as separate rows"
// convention so completion history is preserved. One-time items (renewal_interval_days null) just
// get marked compliant in place.
export function useCompleteResidentComplianceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: ResidentComplianceItem) => {
      const completedDate = new Date().toISOString().slice(0, 10);
      const { data: updated, error: updateError } = await supabase
        .from("resident_compliance_items")
        .update({ completed_date: completedDate, status: "compliant" })
        .eq("id", item.id)
        .select()
        .single();
      if (updateError) throw updateError;

      if (item.renewal_interval_days != null) {
        const nextDue = new Date(`${completedDate}T00:00:00Z`);
        nextDue.setUTCDate(nextDue.getUTCDate() + item.renewal_interval_days);
        const { error: insertError } = await supabase.from("resident_compliance_items").insert({
          organization_id: item.organization_id,
          facility_id: item.facility_id,
          resident_id: item.resident_id,
          item_type: item.item_type,
          due_date: nextDue.toISOString().slice(0, 10),
          renewal_interval_days: item.renewal_interval_days,
          warning_days: item.warning_days,
        });
        if (insertError) throw insertError;
      }
      return updated;
    },
    onSuccess: (data) => queryClient.invalidateQueries({ queryKey: ["resident_compliance_items", data.resident_id] }),
  });
}
