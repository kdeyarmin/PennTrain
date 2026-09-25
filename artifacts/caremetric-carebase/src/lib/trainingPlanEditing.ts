/** Match the annual plan's scoped authoring policy without changing legacy template access. */
export function canManageTrainingPlan(
  role: string | undefined,
  plan: { facility_id: string | null; organization_id: string },
  organizationId: string | null | undefined,
  authorizedFacilityIds: ReadonlySet<string>,
) {
  if (role === "platform_admin") return true;
  if (!organizationId || plan.organization_id !== organizationId) return false;
  if (!plan.facility_id) return role === "org_admin" || role === "trainer";
  return ["org_admin", "trainer", "facility_manager"].includes(role ?? "")
    && authorizedFacilityIds.has(plan.facility_id);
}

export function isExplicitCompletionDeadline(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(`${value}T00:00:00Z`);
  return year > 0 && Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

export function yearlyPlanInputError(input: { facilityId: string; trainingYear: string; dueDate: string }, authorizedFacilityIds: ReadonlySet<string>) {
  if (!authorizedFacilityIds.has(input.facilityId)) return "Choose an active facility you can manage.";
  if (!/^\d{4}$/.test(input.trainingYear) || Number(input.trainingYear) < 1990 || Number(input.trainingYear) > 2200) {
    return "Enter a training year from 1990 through 2200.";
  }
  if (!isExplicitCompletionDeadline(input.dueDate)) return "Enter a valid completion deadline.";
  return null;
}

/** PostgREST failures carry a message but do not inherit from Error. */
export function trainingPlanErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error
    && typeof error.message === "string" && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Training plan operation failed. Please try again.";
}
