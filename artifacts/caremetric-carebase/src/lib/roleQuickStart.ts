import type { Role } from "@/lib/auth";

export interface RoleQuickStartItem {
  title: string;
  description: string;
  href: string;
  cta: string;
}

const ROLE_QUICK_START_ITEMS: Partial<Record<Role, RoleQuickStartItem[]>> = {
  platform_admin: [
    { title: "Triage customer health", description: "Review organizations, support tickets, and release/security signals before making account changes.", href: "/admin", cta: "Open admin dashboard" },
    { title: "Audit privileged activity", description: "Check security governance and audit documentation before impersonation or support actions.", href: "/admin/security", cta: "Review security" },
    { title: "Confirm help coverage", description: "Keep help content current for the pages customers use most often.", href: "/admin/help-content", cta: "Manage help" },
  ],
  org_admin: [
    { title: "Start with daily risk", description: "Open Today to clear urgent alerts, due work, handoffs, and coverage gaps.", href: "/app/today", cta: "Open Today" },
    { title: "Report something that happened", description: "Use one chooser for incidents, complaints, or confidential safety reports.", href: "/app/report-event", cta: "Report an event" },
    { title: "Package proof", description: "Assemble binder documentation before survey, leadership, or board review.", href: "/app/compliance-binder", cta: "Open binder" },
  ],
  facility_manager: [
    { title: "Clear shift-critical work", description: "Use Today to review urgent cards first, then due work and human review queues.", href: "/app/today", cta: "Open Today" },
    { title: "Fix staffing and training gaps", description: "Review employees, schedules, training matrix, and missing documents for assigned facilities.", href: "/app/employees", cta: "Review staff" },
    { title: "Survey Day when they arrive", description: "Activate Survey Day for entrance checklist, binder, staff roster, and evidence room.", href: "/app/survey-day", cta: "Open Survey Day" },
  ],
  trainer: [
    { title: "Check today's classes", description: "Confirm rosters, QR/kiosk check-in, and completion readiness before the session starts.", href: "/trainer", cta: "Open trainer dashboard" },
    { title: "Close training gaps", description: "Matrix, retraining, and pending approvals in one hub.", href: "/trainer/gaps", cta: "Open gaps" },
    { title: "Schedule the next session", description: "Create or duplicate a class, choose attendees, and export calendar details.", href: "/trainer/classes", cta: "Manage classes" },
  ],
  employee: [
    { title: "Do these next", description: "Start with overdue courses, attestations, credentials, and training records before due-soon items.", href: "/me", cta: "Open my day" },
    { title: "Resume assigned courses", description: "Continue online courses and quizzes, including offline-ready material when available.", href: "/me/courses", cta: "Open courses" },
    { title: "Keep proof current", description: "Upload or review credentials, certificates, and policy acknowledgements so managers can verify compliance.", href: "/me/credentials", cta: "Review credentials" },
  ],
  auditor: [
    { title: "Start with scoped priorities", description: "Review Today in read-only mode for open documentation requests, alerts, and compliance follow-up.", href: "/app/today", cta: "Open Today" },
    { title: "Trace documentation", description: "Use binder, inspection readiness, and reports to verify source records without changing operational data.", href: "/app/compliance-binder", cta: "Open binder" },
    { title: "Review survey posture", description: "Focus on inspection readiness and Survey Day documentation before requesting exports.", href: "/app/inspection-readiness", cta: "Inspection readiness" },
  ],
};

export function roleQuickStartItems(role: Role | undefined): RoleQuickStartItem[] {
  if (!role) return [];
  return ROLE_QUICK_START_ITEMS[role] ?? [];
}
