export const CANONICAL_ROUTES = {
  employeeTrainings: "/me/trainings",
  employeeSchedule: "/me/schedule",
  policyDocuments: "/app/policy-documents",
  maintenance: "/app/maintenance",
  shiftHandoffs: "/app/shift-handoffs",
} as const;

export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  "/app/my-trainings": CANONICAL_ROUTES.employeeTrainings,
  "/app/my-schedule": CANONICAL_ROUTES.employeeSchedule,
  "/app/policies": CANONICAL_ROUTES.policyDocuments,
  "/app/shift-log": CANONICAL_ROUTES.shiftHandoffs,
};

export function canonicalInternalPath(path: string): string {
  const match = path.match(/^([^?#]*)(.*)$/u);
  const pathname = match?.[1] ?? path;
  const suffix = match?.[2] ?? "";
  const direct = LEGACY_ROUTE_REDIRECTS[pathname];
  if (direct) return `${direct}${suffix}`;
  if (pathname.startsWith("/app/work-orders/")) {
    return `${CANONICAL_ROUTES.maintenance}/${pathname.slice("/app/work-orders/".length)}${suffix}`;
  }
  if (pathname.startsWith("/admin/work-orders/")) {
    return `${CANONICAL_ROUTES.maintenance}/${pathname.slice("/admin/work-orders/".length)}${suffix}`;
  }
  return path;
}
