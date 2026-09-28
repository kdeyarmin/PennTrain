/** The pages shipped by the standalone Train entry point. Kept in sync by route coverage tests. */
export const TRAIN_ROUTE_PATTERNS = [
  "/", "/app", "/me", "/login", "/demo", "/signup", "/forgot-password", "/reset-password",
  "/legal/facility-signup", "/verify/:slug", "/passport/:slug", "/checkin/:token", "/checkin",
  "/privacy", "/terms", "/security", "/admin", "/admin/training-reports",
  "/account/security", "/account/notifications", "/account/announcements", "/account/whats-new",
  "/account/manager-digest/:id", "/app/facilities", "/app/facilities/:id", "/app/employees",
  "/app/invitations", "/app/employees/:id", "/app/my-trainings", "/app/train",
  "/app/training-matrix", "/app/training-types", "/app/courses", "/app/courses/:id",
  "/app/course-assignments", "/app/training-plans", "/app/documents", "/app/pending-approvals",
  "/app/users", "/app/settings", "/app/billing", "/app/governed-learning", "/app/help",
  "/trainer", "/trainer/gaps", "/trainer/classes", "/trainer/classes/:id/kiosk",
  "/trainer/classes/:id", "/trainer/retraining", "/trainer/facilities", "/trainer/facilities/:id",
  "/trainer/employees", "/trainer/employees/:id", "/me/trainings", "/me/certificates",
  "/me/courses", "/me/courses/:assignmentId/offline", "/me/courses/:assignmentId",
  "/me/courses/:assignmentId/quiz/:quizId", "/me/documents", "/me/help",
  "/app/help/tickets/:id", "/me/help/tickets/:id",
] as const;

export function routePatternMatches(pattern: string, path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  return expected.length === actual.length
    && expected.every((segment, index) => segment.startsWith(":") || segment === actual[index]);
}

/** Module access alone is insufficient: the Train bundle deliberately omits CareBase's pages. */
export function pathAvailableInBuild(path: string, product = import.meta.env.VITE_APP_PRODUCT): boolean {
  return product !== "train" || TRAIN_ROUTE_PATTERNS.some((pattern) => routePatternMatches(pattern, path));
}
