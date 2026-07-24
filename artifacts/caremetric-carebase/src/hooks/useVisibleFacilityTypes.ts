import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { FACILITY_TYPES } from "@/lib/facilityTypes";
import { useListFacilities } from "./useFacilities";
import { useListMyFacilityAssignments } from "./useFacilityAssignments";

// platform_admin is unrestricted (every facility type is visible). Org-scoped roles and
// employees gate PCH/ALF-only modules from the facilities they can see. Employee routes and
// nav items (dietary, resident calendar) require this -- leaving them out made
// `facilityTypes` stay `undefined`, which `hasAnyFacilityType` treats as "no match" and
// permanently hid/blocked those pages.
const RESTRICTABLE_ROLES = new Set(["org_admin", "facility_manager", "trainer", "auditor", "employee"]);
// facility_manager/trainer are scoped to specific facilities elsewhere in the app (via
// facility_assignments, e.g. is_assigned_to_facility() in RLS); org_admin/auditor/employee
// see every facility in the org for this UX gate (employees via facilities_select RLS).
const FACILITY_SCOPED_ROLES = new Set(["facility_manager", "trainer"]);

/**
 * The set of `facility_type` values relevant to the current user, for gating nav items/routes
 * that only apply to some facility types (e.g. the PCH/ALF-only resident-compliance module).
 * Derived from facilities already on file rather than a separate org-level setting, so an org
 * that runs more than one facility type (as the demo org already does) sees the union of what
 * all its relevant facilities need.
 *
 * `facilityTypes` is `undefined` while the underlying data is still loading (or has failed to
 * load -- see `isError`). Callers should treat `isLoading`/`isError` as "unresolved" and fail
 * open (rather than reading an `undefined`/empty `facilityTypes` as a confirmed "no") -- this
 * only gates a UX convenience, not a security boundary, since RLS still governs the underlying
 * data either way. `platform_admin` always resolves to every known facility type.
 */
export function useVisibleFacilityTypes() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const isPlatformAdmin = role === "platform_admin";
  const enabled = !!user && RESTRICTABLE_ROLES.has(role);
  const isFacilityScoped = FACILITY_SCOPED_ROLES.has(role);

  const facilitiesQuery = useListFacilities({}, enabled);
  const assignmentsQuery = useListMyFacilityAssignments(user?.id, enabled && isFacilityScoped);

  const isLoading = enabled && (facilitiesQuery.isLoading || (isFacilityScoped && assignmentsQuery.isLoading));
  const isError = enabled && (facilitiesQuery.isError || (isFacilityScoped && assignmentsQuery.isError));

  const facilityTypes = useMemo(() => {
    if (isPlatformAdmin) {
      return new Set(FACILITY_TYPES.map(({ value }) => value));
    }
    if (!enabled || !facilitiesQuery.data) return undefined;
    if (!isFacilityScoped) {
      return new Set(facilitiesQuery.data.map(f => f.facility_type));
    }
    if (!assignmentsQuery.data) return undefined;
    const assignedFacilityIds = new Set(assignmentsQuery.data.map(a => a.facility_id));
    return new Set(
      facilitiesQuery.data.filter(f => assignedFacilityIds.has(f.id)).map(f => f.facility_type)
    );
  }, [isPlatformAdmin, enabled, isFacilityScoped, facilitiesQuery.data, assignmentsQuery.data]);

  return { facilityTypes, isLoading, isError };
}
