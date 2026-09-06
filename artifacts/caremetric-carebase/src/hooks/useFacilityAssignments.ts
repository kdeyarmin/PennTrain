import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
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

/**
 * The facilities a caller may actually WRITE to, out of the org-wide list they can read.
 *
 * `facilities_select` is org-wide, so every dropdown built from `useListFacilities` offers a
 * facility_manager both facilities in a two-facility organization. The insert/update policies are
 * not org-wide -- `employees_insert`, `residents_insert`, `incidents_insert` and their siblings all
 * call `is_assigned_to_facility(facility_id)`, which auto-passes only org_admin/auditor -- so
 * picking the other facility fails with a row-level-security error after the manager has filled in
 * the whole form. Narrowing the picker is the same fix Today.tsx already applies to its facility
 * selector; org_admin, auditor, trainer and platform_admin are unaffected.
 *
 * While the assignment read is in flight a manager sees no options rather than the wrong ones: a
 * create form is the one place where erring toward "offer nothing yet" beats offering a choice the
 * database will refuse.
 */
export function useAssignableFacilities<T extends { id: string }>(
  facilities: readonly T[] | undefined,
): T[] {
  const { user } = useAuth();
  const isManager = user?.role === "facility_manager";
  const myAssignments = useListMyFacilityAssignments(user?.id, isManager);
  const assignedIds = useMemo(
    () => new Set((myAssignments.data ?? []).map((assignment) => assignment.facility_id)),
    [myAssignments.data],
  );
  return useMemo(
    () => (facilities ?? []).filter((facility) => !isManager || assignedIds.has(facility.id)),
    [facilities, isManager, assignedIds],
  );
}
