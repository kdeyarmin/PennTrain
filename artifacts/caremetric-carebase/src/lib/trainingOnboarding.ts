/** URL hints are convenience only: accept IDs only from the caller's loaded, authorized scope. */
export function trainingFacilityFromSearch<T extends { id: string; organization_id: string }>(
  search: string,
  facilities: readonly T[] | undefined,
  organizationId?: string | null,
): T | undefined {
  const params = new URLSearchParams(search);
  if (params.get("source") !== "train") return undefined;
  const id = params.get("facilityId");
  return facilities?.find(facility => facility.id === id
    && (!organizationId || facility.organization_id === organizationId));
}

export function trainingAdministratorFromSearch<T extends { id: string; is_demo?: boolean | null }>(
  search: string,
  organizations: readonly T[] | undefined,
  isPlatformAdmin: boolean,
): T | undefined {
  const params = new URLSearchParams(search);
  if (!isPlatformAdmin || params.get("source") !== "train" || params.get("role") !== "org_admin") return undefined;
  return organizations?.find(organization => organization.id === params.get("organizationId") && !organization.is_demo);
}

export function trainingWorkspaceHref(facilityId?: string | null): string {
  return facilityId ? `/app/train?${new URLSearchParams({ facilityId, source: "train" })}` : "/app/train";
}

export function trainingAdministratorInviteHref(organizationId: string): string {
  return `/admin/users?${new URLSearchParams({ action: "invite", organizationId, role: "org_admin", source: "train" })}`;
}
