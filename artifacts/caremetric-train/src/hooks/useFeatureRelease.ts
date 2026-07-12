import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Caller-scoped release-flag read: "is this capability released for my organization?"
 * Wraps the server-side rollout/cohort/kill-switch evaluation, so clients never
 * duplicate that logic. Flags flip rarely; a long staleTime keeps this to roughly one
 * request per session per key. Defaults to false while loading or on error -- flagged
 * capabilities must fail closed.
 */
export function useFeatureReleaseActive(featureKey: string) {
  const query = useQuery({
    queryKey: ["feature_release", featureKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("feature_release_active", {
        p_feature_key: featureKey,
      });
      if (error) throw error;
      return data === true;
    },
    staleTime: 5 * 60_000,
  });
  return { ...query, isActive: query.data === true };
}
