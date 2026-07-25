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

  // Settled-ness comes from the cache timestamps, not from isLoading/isError, and the difference is
  // a permanent hang. The live flags cycle: when this query errors, ProtectedRoute's gate stops
  // rendering the page; remounting the page mounts a second observer on the same key, retryOnMount
  // refetches, the status flips back toward loading, the gate unmounts the page again, and the app
  // is now a spinner <-> remount loop that survives indefinitely -- a transient facilities failure
  // becomes a permanently blank route (observed live: a request burst every few seconds, forever,
  // with the page never mounted long enough to paint a heading). The timestamps only move when a
  // fetch actually settles, so "has ever settled" and "latest settle was an error" hold steady
  // while a refetch is in flight, and the gate makes one decision instead of oscillating.
  const settled = (query: { dataUpdatedAt: number; errorUpdatedAt: number }) =>
    query.dataUpdatedAt > 0 || query.errorUpdatedAt > 0;
  const failedLast = (query: { dataUpdatedAt: number; errorUpdatedAt: number }) =>
    query.errorUpdatedAt > query.dataUpdatedAt;

  const isLoading = enabled
    && (!settled(facilitiesQuery) || (isFacilityScoped && !settled(assignmentsQuery)));
  const isError = enabled
    && (failedLast(facilitiesQuery) || (isFacilityScoped && failedLast(assignmentsQuery)));

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
