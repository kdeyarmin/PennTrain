import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type TrainingOrderResource = "course_blocks" | "quiz_questions" | "training_plan_items" | "competency_template_items";
type OrderedItem = { id: string; sort_order: number };

export function useTrainingItemOrder(resource: TrainingOrderResource) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ first, second }: { first: OrderedItem; second: OrderedItem }) => {
      const { error } = await supabase.rpc("swap_training_item_order", {
        p_resource: resource, p_first_id: first.id, p_second_id: second.id,
        p_first_sort_order: first.sort_order, p_second_sort_order: second.sort_order,
      });
      if (error) throw error;
    },
    // A stale position or lost response requires an authoritative reload before retry.
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: [resource === "training_plan_items" ? "training_plans" : resource] }),
      ...(resource === "course_blocks" || resource === "quiz_questions"
        ? [client.invalidateQueries({ queryKey: ["courses", "versions"] })] : []),
    ]),
  });
}
