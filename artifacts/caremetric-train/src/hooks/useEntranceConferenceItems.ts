import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type EntranceConferenceItem = Tables<"entrance_conference_items">;

export function useListEntranceConferenceItems() {
  return useQuery({
    queryKey: ["entrance_conference_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entrance_conference_items")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}
