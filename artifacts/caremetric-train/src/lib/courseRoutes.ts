import type { Role } from "@/lib/auth";

// Course authoring pages (Courses, CourseDetail, QuizBuilder) are shared between
// the org-scoped `/app/*` browse/enroll experience and the platform_admin-only
// `/admin/*` authoring experience -- same components, mounted at two route
// prefixes (see App.tsx). These helpers pick the right prefix for the current
// user's role so the components don't hardcode either one.
function isPlatformAdmin(role: Role | undefined): boolean {
  return role === "platform_admin";
}

export function coursesListPath(role: Role | undefined): string {
  return isPlatformAdmin(role) ? "/admin/courses" : "/app/courses";
}

export function courseDetailPath(id: string, role: Role | undefined): string {
  return isPlatformAdmin(role) ? `/admin/courses/${id}` : `/app/courses/${id}`;
}

export function quizBuilderPath(quizId: string, role: Role | undefined): string {
  return isPlatformAdmin(role) ? `/admin/quizzes/${quizId}` : `/app/quizzes/${quizId}`;
}
