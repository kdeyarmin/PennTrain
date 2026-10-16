import { facilityToday } from "@/lib/dateUtils";

/**
 * What a brand-new training customer has to do, in the order they can actually do it.
 * A location comes first because staff and course assignments belong to one.
 */
export interface TrainingOwnerCounts {
  facilities: number;
  /** Active people on the roster. */
  staff: number;
  /** People who already have a linked sign-in. */
  portalReady: number;
  plans: number;
  assigned: number;
}

export interface TrainingOwnerLinks {
  facilityHref: string;
  addStaffHref: string;
  assignmentsHref: string;
}

export interface TrainingOwnerStep {
  key: "facility" | "staff" | "invite" | "assign" | "progress";
  title: string;
  detail: string;
  done: boolean;
  blocked: boolean;
  blockedReason?: string;
  cta: string;
  /** In-workspace tab. The primary action uses either this or href. */
  tab?: string;
  href?: string;
}

/** The guide can step aside once a location, a roster, and at least one assignment exist. */
export function trainingOwnerSetupFinished(counts: TrainingOwnerCounts): boolean {
  return counts.facilities > 0 && counts.staff > 0 && counts.assigned > 0;
}

export function buildTrainingOwnerSteps(
  counts: TrainingOwnerCounts,
  links: TrainingOwnerLinks,
): TrainingOwnerStep[] {
  const hasFacility = counts.facilities > 0;
  const needsLocation = hasFacility
    ? { blocked: false as const }
    : {
        blocked: true as const,
        blockedReason: "Add your location first. Staff and trainings belong to one.",
      };
  const people = counts.staff === 1 ? "person" : "people";

  return [
    {
      key: "facility",
      title: "Add your location",
      detail: "Staff, courses, and certificates belong to a facility. Use the name on your license.",
      done: hasFacility,
      blocked: false,
      cta: "Add a location",
      href: links.facilityHref,
    },
    {
      key: "staff",
      title: "Add your staff",
      detail: hasFacility
        ? `${counts.staff} active ${people} on the roster. Add one person, or import a spreadsheet.`
        : "Add people one at a time, or import a spreadsheet.",
      done: counts.staff > 0,
      cta: counts.staff > 0 ? "Add more staff" : "Add staff",
      href: links.addStaffHref,
      ...needsLocation,
    },
    {
      key: "invite",
      title: "Invite them to sign in",
      detail: counts.staff === 0
        ? "Each person with an email gets a link to create their own password. You can resend it from Invitation history."
        : `${counts.portalReady} of ${counts.staff} ${counts.staff === 1 ? "has" : "have"} a sign-in. People without an email can still attend class in person.`,
      done: counts.portalReady > 0,
      cta: "Send invites",
      tab: "students",
      ...needsLocation,
    },
    {
      key: "assign",
      title: "Assign required trainings",
      detail: counts.assigned > 0
        ? `${counts.assigned} course ${counts.assigned === 1 ? "assignment is" : "assignments are"} out. Select a job title to enroll a whole role at once.`
        : counts.plans > 0
          ? `${counts.plans} learning ${counts.plans === 1 ? "plan is" : "plans are"} ready. Assign courses to a person or a whole job title.`
          : "Pick courses from the library and assign them to a person or a job title. A learning plan is optional.",
      done: counts.assigned > 0,
      cta: "Assign courses",
      href: links.assignmentsHref,
      ...needsLocation,
    },
    {
      key: "progress",
      title: "Check progress and certificates",
      detail: "See who is overdue, who finished, and download certificates. Staff turn email or text reminders on under Account notifications.",
      done: false,
      cta: "Open reports",
      tab: "enrollments",
      ...needsLocation,
    },
  ];
}

/** A deadline the administrator can change. It is a suggestion, not a regulatory date. */
export function suggestedTrainingDueDate(today = facilityToday()): string {
  const [year, month, day] = today.split("-").map(Number);
  if (!year || !month || !day) return today;
  const next = new Date(Date.UTC(year, month - 1, day + 30));
  return next.toISOString().slice(0, 10);
}

export function employeeIdsMatchingJobTitle<T extends { id: string; job_title?: string | null }>(
  employees: readonly T[],
  jobTitle: string,
): string[] {
  const needle = jobTitle.trim().toLowerCase();
  if (!needle) return [];
  return employees
    .filter((employee) => (employee.job_title ?? "").trim().toLowerCase() === needle)
    .map((employee) => employee.id);
}
