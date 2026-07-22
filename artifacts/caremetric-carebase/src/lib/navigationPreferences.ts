type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

const DEFAULT_FAVORITE_PATHS_BY_ROLE: Partial<Record<UserRole, string[]>> = {
  platform_admin: ["/admin", "/admin/organizations", "/admin/support-tickets", "/admin/security"],
  org_admin: ["/app/today", "/app", "/app/alerts", "/app/work", "/app/reports"],
  facility_manager: ["/app/today", "/app/alerts", "/app/work", "/app/employees", "/app/schedule"],
  trainer: ["/trainer", "/trainer/classes", "/app/training-matrix", "/app/courses", "/trainer/retraining"],
  employee: ["/me", "/me/courses", "/me/schedule", "/me/credentials", "/me/attestations"],
  auditor: ["/app/today", "/app", "/app/compliance-binder", "/app/inspection-readiness", "/app/reports"],
};

export function defaultFavoritePathsForRole(role: string | undefined): string[] {
  return DEFAULT_FAVORITE_PATHS_BY_ROLE[role as UserRole] ?? [];
}

export function navigationFavoritePaths(storedFavoritePaths: string[] | null | undefined, hasPreferenceRow: boolean, role: string | undefined): string[] {
  if (hasPreferenceRow) return storedFavoritePaths ?? [];
  return defaultFavoritePathsForRole(role);
}

