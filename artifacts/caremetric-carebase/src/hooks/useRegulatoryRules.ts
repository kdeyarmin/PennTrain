import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ActiveRegulatoryRule {
  id: string;
  version_number: number;
  state: string;
  citation: string;
  source_uri: string | null;
  source_checksum_sha256: string;
  content_checksum_sha256: string;
  effective_from: string;
  effective_to: string | null;
  applicability: Record<string, unknown>;
  calculation_parameters: Record<string, unknown>;
  regulatory_rule_packs: { rule_key: string; name: string } | null;
}

export function useActiveRegulatoryRules() {
  return useQuery({
    queryKey: ["active-regulatory-rules"],
    queryFn: async (): Promise<ActiveRegulatoryRule[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("regulatory_rule_versions")
        .select("id,version_number,state,citation,source_uri,source_checksum_sha256,content_checksum_sha256,effective_from,effective_to,applicability,calculation_parameters,regulatory_rule_packs(rule_key,name)")
        .in("state", ["active", "superseded"])
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ActiveRegulatoryRule[];
    },
    staleTime: 5 * 60_000,
  });
}
