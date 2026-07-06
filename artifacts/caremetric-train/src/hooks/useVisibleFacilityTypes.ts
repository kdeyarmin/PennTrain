import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "./useFacilities";
import { useListMyFacilityAssignments } from "./useFacilityAssignments";

// platform_admin sees every nav item regardless of facility type (same "no restriction" posture
// as its role generally), and employee has no facility-type-restricted nav items at all -- so
// this hook only needs to compute anything for the four org-scoped roles.
const RESTRICTABLE_ROLES = new Set(["org_admin", "facility_manager", "trainer", "auditor"]);
// facility_manager/trainer are scoped to specific facilities elsewhere in the app (via
// facility_assignments, e.g. is_assigned_to_facility() in RLS); org_admin/auditor see every
// facility in the org. Mirror that same scoping here.
const FACILITY_SCOPED_ROLES = new Set(["facility_manager", "trainer"]);

/**
 * The set of `facility_type` values relevant to the current user, for gating nav items/routes
 * that only apply to some facility types (e.g. the PCH/ALR-only resident-compliance module).
 * Derived from facilities already on file rather than a separate org-level setting, so an org
 * that runs more than one facility type (as the demo org already does) sees the union of what
 * all its relevant facilities need.
 *
 * `facilityTypes` is `undefined` while the underlying data is still loading, or for roles this
 * doesn't apply to (see RESTRICTABLE_ROLES).
 */
export function useVisibleFacilityTypes() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const enabled = !!user && RESTRICTABLE_ROLES.has(role);
  const isFacilityScoped = FACILITY_SCOPED_ROLES.has(role);

  const facilitiesQuery = useListFacilities({}, enabled);
  const assignmentsQuery = useListMyFacilityAssignments(user?.id, enabled && isFacilityScoped);

  const isLoading = enabled && (facilitiesQuery.isLoading || (isFacilityScoped && assignmentsQuery.isLoading));

  const facilityTypes = useMemo(() => {
    if (!enabled || !facilitiesQuery.data) return undefined;
    if (!isFacilityScoped) {
      return new Set(facilitiesQuery.data.map(f => f.facility_type));
    }
    if (!assignmentsQuery.data) return undefined;
    const assignedFacilityIds = new Set(assignmentsQuery.data.map(a => a.facility_id));
    return new Set(
      facilitiesQuery.data.filter(f => assignedFacilityIds.has(f.id)).map(f => f.facility_type)
    );
  }, [enabled, isFacilityScoped, facilitiesQuery.data, assignmentsQuery.data]);

  return { facilityTypes, isLoading };
}
