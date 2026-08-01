import type { GuidedSetupItem } from "@/lib/enterpriseOperations";

/**
 * What a brand-new organization actually has after signup: an `organizations` row and one
 * org_admin profile. No facility, no roster, no residents.
 *
 * That matters because facility_id is not optional plumbing -- employees, residents,
 * schedules, incidents, and every compliance record hang off a facility. Until one exists
 * the whole app renders as a set of correct-but-empty pages, and nothing on screen says
 * which of them to open first.
 */
export interface OrganizationSetupCounts {
  facilities: number;
  employees: number;
  residents: number;
  /** Team members beyond the founding org_admin. */
  teamMembers: number;
}

export interface OrganizationSetupStep extends GuidedSetupItem {
  href: string;
  cta: string;
  /** Steps that cannot be started yet because an earlier one hasn't been done. */
  blocked: boolean;
  blockedReason?: string;
}

/**
 * The ordered first-run path. Order is a real dependency chain, not a suggestion: a facility
 * has to exist before staff or residents can be attached to one, so the later steps are
 * marked blocked rather than merely incomplete.
 */
export function buildOrganizationSetupSteps(counts: OrganizationSetupCounts): OrganizationSetupStep[] {
  const hasFacility = counts.facilities > 0;
  const needsFacilityFirst = hasFacility
    ? {}
    : { blocked: true, blockedReason: "Add a facility first — staff and residents belong to one." };

  return [
    {
      key: "facility",
      label: "Add your first facility",
      why: "Staff, residents, schedules, and every compliance record belong to a facility.",
      complete: hasFacility,
      href: "/app/facilities",
      cta: "Add facility",
      blocked: false,
    },
    {
      key: "employees",
      label: "Add your staff",
      why: "The training matrix and compliance reports are built from your roster.",
      complete: counts.employees > 0,
      href: hasFacility ? "/app/employees" : "/app/facilities",
      cta: "Add staff",
      blocked: false,
      ...needsFacilityFirst,
    },
    {
      key: "residents",
      label: "Add your residents",
      why: "Resident records drive assessments, state forms, and move-in readiness.",
      complete: counts.residents > 0,
      href: hasFacility ? "/app/residents" : "/app/facilities",
      cta: "Add residents",
      blocked: false,
      ...needsFacilityFirst,
    },
    {
      key: "team",
      label: "Invite your team",
      why: "Managers, trainers, and auditors each need their own sign-in to do their part.",
      complete: counts.teamMembers > 1,
      href: "/app/users",
      cta: "Invite team",
      blocked: false,
    },
  ];
}

/**
 * Whether to show the setup guide at all. Keyed on facilities and roster rather than on
 * "every step done" so an organization that deliberately skips, say, residents is not
 * nagged forever -- once it is genuinely operating, the guide retires itself.
 */
export function organizationNeedsSetup(counts: OrganizationSetupCounts): boolean {
  return counts.facilities === 0 || counts.employees === 0;
}
