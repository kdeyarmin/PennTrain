import type { Facility } from "@/hooks/useFacilities";
import type { Employee } from "@/hooks/useEmployees";
import type { Practicum } from "@/hooks/usePracticums";
import type { Role } from "@/lib/auth";

/**
 * Roles whose RLS-visible employees/practicums already span every facility in the org
 * (see employees_select / practicums_select in the Group A/B RLS policies: they grant
 * full org visibility to org_admin/auditor, and is_assigned_to_facility() itself always
 * returns true for platform_admin). For every other role, visibility is scoped to
 * facilities the profile is explicitly assigned to via facility_assignments.
 */
export const ORG_WIDE_VISIBILITY_ROLES: ReadonlySet<Role> = new Set([
  "platform_admin",
  "org_admin",
  "auditor",
]);

export type FacilityOverallStatus = "compliant" | "due_soon" | "expired" | "critical" | "unknown";

export interface FacilityRetrainingStatus {
  facilityId: string;
  facilityName: string;
  facilityType: string;
  totalMedAdminStaff: number;
  compliantCount: number;
  dueSoonCount: number;
  expiredCount: number;
  missingCount: number;
  nextExpiryDate: string | null;
  overallStatus: FacilityOverallStatus;
  /**
   * False when the current user has no RLS visibility into this facility's
   * employees/practicums (i.e. it's outside their facility assignments) -- as opposed
   * to a facility that is genuinely fully staffed and compliant. When false,
   * overallStatus is always "unknown" and the count fields are not meaningful
   * (they reflect zero *visible* rows, not zero actual rows).
   */
  isVisible: boolean;
}

export interface FacilityVisibilityContext {
  /** The current user's role. Org-wide-visibility roles always see every facility's data. */
  role: Role | null | undefined;
  /**
   * Facility IDs the current user is explicitly assigned to (via facility_assignments).
   * Only consulted for roles outside ORG_WIDE_VISIBILITY_ROLES.
   */
  assignedFacilityIds?: ReadonlySet<string>;
}

// There is no server-side facility retraining aggregate (the old Express endpoint
// is gone); derive the same shape from facilities + employees + practicums.
//
// Facilities are RLS-readable org-wide (facilities_select has no assignment scoping),
// but employees/practicums are scoped to a trainer's assigned facilities via
// is_assigned_to_facility(). Without a `visibility` context, a facility outside the
// caller's assignments would silently look "compliant, 0 staff" -- indistinguishable
// from a facility that genuinely has no med-admin staff. Pass `visibility` so those
// facilities are reported as "unknown" instead.
export function buildFacilityRetrainingStatus(
  facilities: Facility[],
  employees: Employee[],
  practicums: Practicum[],
  visibility?: FacilityVisibilityContext
): FacilityRetrainingStatus[] {
  const hasOrgWideVisibility =
    !visibility || !visibility.role || ORG_WIDE_VISIBILITY_ROLES.has(visibility.role);

  return facilities.map((facility) => {
    const isVisible = hasOrgWideVisibility || (visibility?.assignedFacilityIds?.has(facility.id) ?? false);

    // Only active staff currently administer medications day-to-day; inactive/terminated/
    // on_leave employees shouldn't count toward a facility's retraining exposure.
<<<<<<< HEAD:artifacts/pa-medtrack/src/lib/facilityRetrainingStatus.ts
    const staffCount = employees.filter(
      (e) => e.facility_id === facility.id && e.status === "active" && e.administers_medications
    ).length;
    const facilityPracticums = practicums.filter((p) => p.facility_id === facility.id);
=======
    const activeStaffIds = new Set(
      employees
        .filter((e) => e.facility_id === facility.id && e.status === "active" && e.administers_medications)
        .map((e) => e.id)
    );
    const staffCount = activeStaffIds.size;
    // Practicum status is recomputed nightly purely from due_date, with no server-side
    // check on the owning employee's status, so a terminated employee's last practicum
    // stays "expired" forever. Exclude those rows here so the facility's compliance
    // picture reflects only currently-active staff.
    const facilityPracticums = practicums.filter(
      (p) => p.facility_id === facility.id && activeStaffIds.has(p.employee_id)
    );
>>>>>>> origin/main:artifacts/caremetric-train/src/lib/facilityRetrainingStatus.ts

    const compliantCount = facilityPracticums.filter((p) => p.status === "compliant").length;
    const dueSoonCount = facilityPracticums.filter((p) => p.status === "due_soon").length;
    const expiredCount = facilityPracticums.filter((p) => p.status === "expired").length;
    const missingCount = facilityPracticums.filter((p) => p.status === "missing").length;

    const upcoming = facilityPracticums
      .filter((p) => p.due_date && (p.status === "due_soon" || p.status === "expired"))
      .map((p) => p.due_date as string)
      .sort();
    const nextExpiryDate = upcoming[0] ?? null;

    let overallStatus: FacilityOverallStatus;
    if (!isVisible) {
      overallStatus = "unknown";
    } else {
      overallStatus = "compliant";
      if (staffCount > 0 && expiredCount > 0 && compliantCount === 0) overallStatus = "critical";
      else if (expiredCount > 0) overallStatus = "expired";
      else if (dueSoonCount > 0 || missingCount > 0) overallStatus = "due_soon";
    }

    return {
      facilityId: facility.id,
      facilityName: facility.name,
      facilityType: facility.facility_type,
      totalMedAdminStaff: staffCount,
      compliantCount,
      dueSoonCount,
      expiredCount,
      missingCount,
      nextExpiryDate,
      overallStatus,
      isVisible,
    };
  });
}
