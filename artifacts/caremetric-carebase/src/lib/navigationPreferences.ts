import type { Role } from "@/lib/auth";

const DEFAULT_FAVORITE_PATHS_BY_ROLE: Partial<Record<Role, string[]>> = {
  platform_admin: ["/admin", "/admin/organizations", "/admin/support-tickets", "/admin/security"],
  org_admin: ["/app/today", "/app", "/app/alerts", "/app/work", "/app/reports"],
  facility_manager: ["/app/today", "/app/alerts", "/app/work", "/app/employees", "/app/schedule"],
  trainer: ["/trainer", "/trainer/classes", "/app/training-matrix", "/app/courses", "/trainer/retraining"],
  employee: ["/me", "/me/courses", "/me/schedule", "/me/credentials", "/me/attestations"],
  auditor: ["/app/today", "/app", "/app/compliance-binder", "/app/inspection-readiness", "/app/reports"],
};

export function defaultFavoritePathsForRole(role: Role | undefined): string[] {
  if (!role) return [];
  return DEFAULT_FAVORITE_PATHS_BY_ROLE[role] ?? [];
}

export function navigationFavoritePaths(
  storedFavoritePaths: string[] | null | undefined,
  hasPreferenceRow: boolean,
  role: Role | undefined,
): string[] {
  if (hasPreferenceRow) return storedFavoritePaths ?? [];
  return defaultFavoritePathsForRole(role);
}
