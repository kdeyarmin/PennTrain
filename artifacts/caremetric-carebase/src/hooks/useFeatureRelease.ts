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

/**
 * Caller-scoped entitlement read: "does my organization have this app_feature_flags feature?"
 * Wraps org_feature_enabled (evaluate_feature_access for current_org_id), the sibling of
 * feature_release_active for the entitlement/flag system rather than the release system. Lets the
 * UI gate a pilot feature the same way the backend commands do instead of rendering controls that
 * only 42501 on click. Defaults to false while loading or on error -- gated capabilities fail closed.
 */
export function useOrgFeatureEnabled(featureKey: string) {
  const query = useQuery({
    queryKey: ["org_feature_enabled", featureKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_feature_enabled", {
        p_feature_key: featureKey,
      });
      if (error) throw error;
      return data === true;
    },
    staleTime: 5 * 60_000,
  });
  return { ...query, isEnabled: query.data === true };
}
