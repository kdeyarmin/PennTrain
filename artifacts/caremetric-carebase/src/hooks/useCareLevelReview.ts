import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildCareLevelReview, type RateAgreementLike, type ResidentLike } from "@/lib/careLevelReview";

// Facility-wide care-level / billing review. Fetches the three sources that bridge assessed acuity to
// the billed level of care -- rate agreements (the billed side) and the two assessment sources (the
// assessed side) -- all readable facility-wide under existing RLS. Residents come from the caller
// (already loaded, active-only); the pure engine joins and scores them.
export function useCareLevelReview(facilityId: string | undefined, residents: ResidentLike[]) {
  const sources = useQuery({
    queryKey: ["care-level-review", facilityId],
    enabled: !!facilityId,
    queryFn: async () => {
      const [rates, clinical, forms] = await Promise.all([
        supabase
          .from("resident_rate_agreements")
          .select("resident_id,level_of_care_charge,effective_from,effective_through,version_number")
          .eq("facility_id", facilityId!),
        // Only finalized assessments substantiate a level of care; a draft that is merely open or
        // being edited must not suppress the "no assessment" signal or fake a reassessment date.
        supabase
          .from("clinical_assessments")
          .select("resident_id,assessed_at")
          .eq("facility_id", facilityId!)
          .in("status", ["final", "amended"]),
        supabase
          .from("resident_assessment_forms")
          .select("resident_id,updated_at")
          .eq("facility_id", facilityId!)
          .eq("status", "finalized"),
      ]);
      const failed = [rates, clinical, forms].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        rates: (rates.data ?? []) as RateAgreementLike[],
        clinical: (clinical.data ?? []).map((row) => ({ resident_id: row.resident_id, at: row.assessed_at })),
        forms: (forms.data ?? []).map((row) => ({ resident_id: row.resident_id, at: row.updated_at })),
      };
    },
  });

  const rows = useMemo(() => {
    if (!sources.data) return [];
    return buildCareLevelReview(residents, sources.data.rates, [sources.data.clinical, sources.data.forms]);
  }, [residents, sources.data]);

  return { rows, isLoading: sources.isLoading, isError: sources.isError, error: sources.error };
}
