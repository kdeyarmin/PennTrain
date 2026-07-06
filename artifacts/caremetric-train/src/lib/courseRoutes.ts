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

// Unlike coursesListPath/courseDetailPath above, quiz authoring has no org-scoped `/app/quizzes/*`
// route -- course/quiz authoring is platform_admin-exclusive by RLS and UI (see
// 20260705203242_restrict_course_authoring_to_platform_admin.sql), so there is only ever an
// `/admin/quizzes/:quizId` destination to link to.
export function quizBuilderPath(quizId: string, _role: Role | undefined): string {
  return `/admin/quizzes/${quizId}`;
}
