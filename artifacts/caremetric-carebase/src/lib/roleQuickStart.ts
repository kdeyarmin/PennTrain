export interface RoleQuickStartItem {
  title: string;
  description: string;
  href: string;
  cta: string;
}

type UserRole = "platform_admin" | "org_admin" | "facility_manager" | "trainer" | "employee" | "auditor";

const ROLE_QUICK_START_ITEMS: Partial<Record<UserRole, RoleQuickStartItem[]>> = {
  platform_admin: [
    { title: "Triage customer health", description: "Review organizations, support tickets, and release/security signals before making account changes.", href: "/admin", cta: "Open admin dashboard" },
    { title: "Audit privileged activity", description: "Check security governance and audit evidence before impersonation or support actions.", href: "/admin/security", cta: "Review security" },
    { title: "Confirm help coverage", description: "Keep help content current for the pages customers use most often.", href: "/admin/help-content", cta: "Manage help" },
  ],
  org_admin: [
    { title: "Start with daily risk", description: "Open Today to clear urgent alerts, due work, handoffs, and coverage gaps.", href: "/app/today", cta: "Open Today" },
    { title: "Work the action plan", description: "Use the dashboard priority plan to drill into expired training, missing evidence, and low-scoring facilities.", href: "/app", cta: "Open dashboard" },
    { title: "Package proof", description: "Run reports or assemble binder evidence before survey, leadership, or board review.", href: "/app/reports", cta: "Run reports" },
  ],
  facility_manager: [
    { title: "Clear shift-critical work", description: "Use Today to review urgent cards first, then due work and human review queues.", href: "/app/today", cta: "Open Today" },
    { title: "Fix staffing and training gaps", description: "Review employees, schedules, training matrix, and missing documents for assigned facilities.", href: "/app/employees", cta: "Review staff" },
    { title: "Prepare evidence as work happens", description: "Use work items, alerts, and binder evidence instead of waiting for inspection week.", href: "/app/work", cta: "Open work queue" },
  ],
  trainer: [
    { title: "Check today's classes", description: "Confirm rosters, QR/kiosk check-in, and completion readiness before the session starts.", href: "/trainer", cta: "Open trainer dashboard" },
    { title: "Schedule the next session", description: "Create or duplicate a class, choose attendees, and export calendar details.", href: "/trainer/classes", cta: "Manage classes" },
    { title: "Close retraining gaps", description: "Use the matrix and retraining monitor to focus on expiring or expired requirements.", href: "/trainer/retraining", cta: "Open monitor" },
  ],
  employee: [
    { title: "Complete what is overdue", description: "Start with overdue courses, attestations, credentials, and training records before due-soon items.", href: "/me", cta: "Open my training" },
    { title: "Resume assigned courses", description: "Continue online courses and quizzes, including offline-ready material when available.", href: "/me/courses", cta: "Open courses" },
    { title: "Keep proof current", description: "Upload or review credentials, certificates, and policy acknowledgements so managers can verify compliance.", href: "/me/credentials", cta: "Review credentials" },
  ],
  auditor: [
    { title: "Start with scoped priorities", description: "Review Today in read-only mode for open evidence requests, alerts, and compliance follow-up.", href: "/app/today", cta: "Open Today" },
    { title: "Trace evidence", description: "Use binder, inspection readiness, and reports to verify source records without changing operational data.", href: "/app/compliance-binder", cta: "Open binder" },
    { title: "Review survey posture", description: "Focus on inspection readiness and survey-day evidence before requesting exports.", href: "/app/inspection-readiness", cta: "Inspection readiness" },
  ],
};

export function roleQuickStartItems(role: string | undefined): RoleQuickStartItem[] {
  return ROLE_QUICK_START_ITEMS[role as UserRole] ?? [];
}
