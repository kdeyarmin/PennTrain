import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type EntranceConferenceItem = Tables<"entrance_conference_items"> & {
  /** Present after migration 20260801160000; optional until types regenerate. */
  regulation_ref?: string | null;
};

/** Compare refs like §2600.65 — nulls last. */
function compareRegulationRef(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const num = (s: string) => {
    const m = s.match(/(\d+)(?:\.(\d+))?/);
    if (!m) return Number.POSITIVE_INFINITY;
    return Number(m[1]) * 1000 + Number(m[2] ?? 0);
  };
  const d = num(a) - num(b);
  return d !== 0 ? d : a.localeCompare(b);
}

export function useListEntranceConferenceItems() {
  return useQuery({
    queryKey: ["entrance_conference_items", "by-regulation-ref"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entrance_conference_items")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      const rows = (data ?? []) as EntranceConferenceItem[];
      return [...rows].sort((left, right) => {
        const byReg = compareRegulationRef(left.regulation_ref, right.regulation_ref);
        if (byReg !== 0) return byReg;
        return (left.sort_order ?? 0) - (right.sort_order ?? 0);
      });
    },
  });
}
