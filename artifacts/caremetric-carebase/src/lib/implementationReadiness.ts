export interface ImplementationTaskLike {
  task_key: string;
  title: string;
  status: string;
  required?: boolean | null;
  due_date?: string | null;
  owner_profile_id?: string | null;
  evidence_note?: string | null;
}

export interface ImplementationReadinessSummary {
  total: number;
  required: number;
  complete: number;
  requiredComplete: number;
  blocked: number;
  overdue: number;
  launchBlockers: number;
  percent: number;
  ready: boolean;
}

const SETTLED = new Set(["complete", "not_applicable"]);

function localDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function summarizeImplementationReadiness(
  tasks: ImplementationTaskLike[],
  now = new Date(),
): ImplementationReadinessSummary {
  const requiredTasks = tasks.filter(task => task.required !== false);
  const complete = tasks.filter(task => task.status === "complete").length;
  const requiredComplete = requiredTasks.filter(task => SETTLED.has(task.status)).length;
  const blocked = tasks.filter(task => task.status === "blocked").length;
  const today = localDate(now);
  const overdue = tasks.filter(task =>
    !SETTLED.has(task.status) && !!task.due_date && task.due_date < today,
  ).length;
  const launchBlockers = requiredTasks.filter(task => !SETTLED.has(task.status)).length;
  const percent = requiredTasks.length === 0
    ? 100
    : Math.round((requiredComplete / requiredTasks.length) * 100);

  return {
    total: tasks.length,
    required: requiredTasks.length,
    complete,
    requiredComplete,
    blocked,
    overdue,
    launchBlockers,
    percent,
    ready: launchBlockers === 0,
  };
}

export const IMPLEMENTATION_TASK_ROUTES: Record<string, string> = {
  "org-profile": "/app/facilities",
  "administrator-profile": "/app/administrator-qualification",
  "roles-access": "/app/users",
  "roster-import": "/app/employees?action=bulk-import",
  "resident-import": "/app/admissions",
  "rule-pack": "/app/compliance-command-center",
  "notification-test": "/account/notifications",
  "integration-test": "/app/enterprise",
  "training-launch": "/app/course-assignments",
  "report-validation": "/app/reports",
  "survey-rehearsal": "/app/survey-day",
  "security-readiness": "/account/security",
  "go-live": "/app/inspection-readiness",
};

export function implementationTaskRoute(taskKey: string): string | null {
  return IMPLEMENTATION_TASK_ROUTES[taskKey] ?? null;
}

export function implementationTaskNeedsAttention(task: ImplementationTaskLike, now = new Date()): boolean {
  if (SETTLED.has(task.status)) return false;
  if (task.status === "blocked") return true;
  return !!task.due_date && task.due_date < localDate(now);
}
