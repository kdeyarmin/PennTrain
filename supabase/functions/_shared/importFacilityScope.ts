/**
 * facilities_select is org-wide for facility_manager, but employee/resident/incident
 * writes are assignment-scoped. Import validate builds a facility name→id map from that
 * org-wide list, so an unassigned manager can mark other-facility rows "valid"; the durable
 * worker then applies them with the service role. Narrow the map to assigned facilities.
 */
export async function listImportFacilitiesForCaller(
  // deno-lint-ignore no-explicit-any
  caller: { from: (table: string) => any },
  organizationId: string,
  role: string,
  profileId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await caller
    .from("facilities")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (error) throw error;
  const facilities = (data ?? []) as { id: string; name: string }[];
  if (role !== "facility_manager") return facilities;

  const { data: assignments, error: assignmentError } = await caller
    .from("facility_assignments")
    .select("facility_id")
    .eq("profile_id", profileId);
  if (assignmentError) throw assignmentError;
  const allowed = new Set(
    ((assignments ?? []) as { facility_id: string }[]).map((row) => row.facility_id),
  );
  return facilities.filter((facility) => allowed.has(facility.id));
}
