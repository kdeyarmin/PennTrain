import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";

export type FacilityAssignment = Tables<"facility_assignments">;

/**
 * Facility IDs explicitly assigned (via facility_assignments) to a given profile.
 *
 * RLS on facility_assignments only lets a profile read its own assignment rows
 * (plus org_admin can read all in-org rows), so this is meant to be called with the
 * *current* user's profile id to answer "which facilities can I actually see
 * employee/practicum data for?" for roles that are scoped by
 * public.is_assigned_to_facility() (e.g. trainer, facility_manager) -- as opposed to
 * org_admin/auditor/platform_admin, who see every facility's data regardless of
 * assignment rows.
 */
export function useListMyFacilityAssignments(profileId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["facility_assignments", "mine", profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facility_assignments")
        .select("*")
        .eq("profile_id", profileId!);
      if (error) throw error;
      return data;
    },
    enabled: enabled && !!profileId,
  });
}
