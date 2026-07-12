import type { Role } from "@/lib/auth";

export type AppDomain =
  | "platform"
  | "tenant"
  | "directory"
  | "training"
  | "competency"
  | "credentialing"
  | "scheduling"
  | "residents"
  | "compliance"
  | "documents"
  | "support"
  | "self_service";

export interface AppPageDefinition {
  path: string;
  label: string;
  domain: AppDomain;
  roles: Role[];
  keywords: string[];
}

export interface AppCommandAction {
  id: string;
  label: string;
  description: string;
  path: string;
  domain: AppDomain;
  roles: Role[];
  keywords: string[];
}

const PLATFORM_ADMIN: Role[] = ["platform_admin"];
const ORG_ADMINS: Role[] = ["org_admin"];
const ORG_ROLES: Role[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const ORG_HOME_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const ORG_MANAGERS: Role[] = ["org_admin", "facility_manager"];
const REPORTING_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const CREDENTIAL_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const INSPECTION_ROLES: Role[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const AUDIT_LOG_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const PENDING_APPROVAL_ROLES: Role[] = ["org_admin", "facility_manager", "trainer"];
const TRAINER_ONLY: Role[] = ["trainer"];
const EMPLOYEE_ONLY: Role[] = ["employee"];
const ANY_ROLE: Role[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];

const APP_COMMAND_ACTIONS: AppCommandAction[] = [
  {
    id: "add-employee",
    label: "Add employee",
    description: "Open the employee creation dialog.",
    path: "/app/employees?action=add",
    domain: "directory",
    roles: ["org_admin", "facility_manager"],
    keywords: ["new staff", "hire", "create employee", "onboard"],
  },
  {
    id: "platform-add-employee",
    label: "Add employee",
    description: "Open the platform employee creation dialog.",
    path: "/admin/employees?action=add",
    domain: "directory",
    roles: PLATFORM_ADMIN,
    keywords: ["new staff", "hire", "create employee", "onboard"],
  },
  {
    id: "bulk-import-employees",
    label: "Bulk import employees",
    description: "Upload a roster CSV from the employee directory.",
    path: "/app/employees?action=bulk-import",
    domain: "directory",
    roles: ["org_admin", "facility_manager"],
    keywords: ["csv", "roster", "upload staff", "import staff"],
  },
  {
    id: "platform-bulk-import-employees",
    label: "Bulk import employees",
    description: "Upload a roster CSV from the platform employee directory.",
    path: "/admin/employees?action=bulk-import",
    domain: "directory",
    roles: PLATFORM_ADMIN,
    keywords: ["csv", "roster", "upload staff", "import staff"],
  },
  {
    id: "assign-courses",
    label: "Assign courses",
    description: "Open course assignments to assign or review learner work.",
    path: "/app/course-assignments",
    domain: "training",
    roles: ORG_ROLES,
    keywords: ["training assignment", "learners", "courses", "remediation"],
  },
  {
    id: "schedule-class",
    label: "Schedule an in-service class",
    description: "Open the live class list for scheduling and attendance follow-up.",
    path: "/trainer/classes",
    domain: "training",
    roles: ["trainer", "org_admin", "facility_manager"],
    keywords: ["class", "attendance", "in service", "qr", "kiosk"],
  },
  {
    id: "generate-binder",
    label: "Generate compliance binder",
    description: "Open the evidence binder workflow for survey-ready exports.",
    path: "/app/compliance-binder",
    domain: "documents",
    roles: REPORTING_ROLES,
    keywords: ["survey", "inspection", "packet", "evidence", "export"],
  },
  {
    id: "run-reports",
    label: "Run compliance reports",
    description: "Open the reporting center for filtered compliance exports.",
    path: "/app/reports",
    domain: "documents",
    roles: REPORTING_ROLES,
    keywords: ["analytics", "csv", "saved report", "export"],
  },
  {
    id: "new-ai-course",
    label: "Create AI course",
    description: "Draft a new course from source material in the AI course builder.",
    path: "/admin/courses/new-ai",
    domain: "training",
    roles: PLATFORM_ADMIN,
    keywords: ["generate course", "course builder", "curriculum", "ai"],
  },
  {
    id: "review-failed-notifications",
    label: "Review failed notifications",
    description: "Open notification delivery filtered to failed messages.",
    path: "/admin/notifications?status=failed",
    domain: "support",
    roles: PLATFORM_ADMIN,
    keywords: ["email", "sms", "delivery", "failure"],
  },
  {
    id: "open-support",
    label: "Open Help Center",
    description: "Find an article or create a support ticket.",
    path: "/app/help",
    domain: "support",
    roles: ORG_ROLES,
    keywords: ["ticket", "faq", "job aide", "support"],
  },
  {
    id: "open-employee-support",
    label: "Open Help Center",
    description: "Find an article or create a support ticket.",
    path: "/me/help",
    domain: "support",
    roles: EMPLOYEE_ONLY,
    keywords: ["ticket", "faq", "job aide", "support"],
  },
];

export const APP_PAGES: AppPageDefinition[] = [
  { path: "/account/security", label: "Account security", domain: "self_service", roles: ANY_ROLE, keywords: ["mfa", "aal2", "authenticator", "two factor"] },
  { path: "/admin", label: "Platform dashboard", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["super admin", "command center", "health"] },
  { path: "/admin/organizations", label: "Organizations", domain: "tenant", roles: PLATFORM_ADMIN, keywords: ["tenant", "customer", "subscription"] },
  { path: "/admin/packages", label: "Packages", domain: "tenant", roles: PLATFORM_ADMIN, keywords: ["plans", "subscriptions", "billing"] },
  { path: "/admin/facilities", label: "All facilities", domain: "directory", roles: PLATFORM_ADMIN, keywords: ["locations", "sites"] },
  { path: "/admin/employees", label: "All employees", domain: "directory", roles: PLATFORM_ADMIN, keywords: ["staff", "workforce"] },
  { path: "/admin/users", label: "Platform users", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["access", "roles", "invites"] },
  { path: "/admin/courses", label: "Course catalog", domain: "training", roles: PLATFORM_ADMIN, keywords: ["training", "content"] },
  { path: "/admin/courses/new-ai", label: "AI course builder", domain: "training", roles: PLATFORM_ADMIN, keywords: ["generate", "curriculum", "authoring"] },
  { path: "/admin/ai-generations", label: "AI generation log", domain: "training", roles: PLATFORM_ADMIN, keywords: ["ai", "failures", "cost"] },
  { path: "/admin/alerts", label: "Platform alerts", domain: "compliance", roles: PLATFORM_ADMIN, keywords: ["risk", "overdue"] },
  { path: "/admin/audit", label: "Platform audit log", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["governance", "activity"] },
  { path: "/admin/notifications", label: "Notification delivery", domain: "support", roles: PLATFORM_ADMIN, keywords: ["email", "sms", "failed"] },
  { path: "/admin/system-jobs", label: "System jobs", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["cron", "queue", "health", "freshness", "retry"] },
  { path: "/admin/enterprise", label: "Enterprise foundation", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["portfolio", "regions", "workforce", "rules", "sso", "scim", "billing", "integrations"] },
  { path: "/admin/qualified-workforce", label: "Qualified workforce operations", domain: "credentialing", roles: PLATFORM_ADMIN, keywords: ["hris", "qualification", "credential renewal", "eligibility", "shift swap", "waitlist"] },
  { path: "/admin/governed-learning", label: "Governed learning", domain: "training", roles: PLATFORM_ADMIN, keywords: ["content review", "scorm", "xapi", "lti", "adaptive", "offline"] },
  { path: "/admin/closed-loop-compliance", label: "Closed-loop compliance", domain: "compliance", roles: PLATFORM_ADMIN, keywords: ["remediation", "incident intake", "move in", "historical report", "evidence room", "auditor"] },
  { path: "/admin/exclusion-screening", label: "Exclusion screening", domain: "credentialing", roles: PLATFORM_ADMIN, keywords: ["oig", "sam", "snapshot", "screening"] },
  { path: "/admin/security", label: "Security & governance", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["roles", "audit", "access"] },
  { path: "/admin/support-tickets", label: "Support tickets", domain: "support", roles: PLATFORM_ADMIN, keywords: ["help", "queue"] },
  { path: "/admin/help-content", label: "Help center content", domain: "support", roles: PLATFORM_ADMIN, keywords: ["articles", "knowledge base"] },
  { path: "/admin/settings", label: "Platform settings", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["feature flags", "maintenance", "signup"] },
  { path: "/admin/roadmap", label: "Improvement roadmap", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["phases", "planning", "suggestions", "implementation"] },

  { path: "/app", label: "Organization dashboard", domain: "tenant", roles: ORG_HOME_ROLES, keywords: ["overview", "compliance"] },
  { path: "/app/facilities", label: "Facilities", domain: "directory", roles: ORG_HOME_ROLES, keywords: ["locations", "sites"] },
  { path: "/app/employees", label: "Employees", domain: "directory", roles: ORG_HOME_ROLES, keywords: ["staff", "workforce"] },
  { path: "/app/training-matrix", label: "Training matrix", domain: "training", roles: ORG_ROLES, keywords: ["compliance", "due soon"] },
  { path: "/app/training-types", label: "Training types", domain: "training", roles: ORG_MANAGERS, keywords: ["requirements", "categories"] },
  { path: "/app/courses", label: "Courses", domain: "training", roles: ORG_ROLES, keywords: ["catalog", "lessons"] },
  { path: "/app/course-assignments", label: "Course assignments", domain: "training", roles: ORG_ROLES, keywords: ["assign", "learners"] },
  { path: "/app/training-plans", label: "Training plans", domain: "training", roles: ORG_ROLES, keywords: ["paths", "requirements"] },
  { path: "/app/competency-templates", label: "Competency templates", domain: "competency", roles: ORG_ROLES, keywords: ["skills", "evaluations"] },
  { path: "/app/competency-records", label: "Competency records", domain: "competency", roles: ORG_ROLES, keywords: ["evaluations", "skills"] },
  { path: "/app/practicums", label: "Practicums", domain: "competency", roles: ORG_ROLES, keywords: ["medication", "observations"] },
  { path: "/app/administrator-qualification", label: "Administrator qualification", domain: "credentialing", roles: ORG_MANAGERS, keywords: ["administrator", "continuing education"] },
  { path: "/app/med-admin-roster", label: "Who can pass meds", domain: "credentialing", roles: ORG_ROLES, keywords: ["medication", "roster"] },
  { path: "/app/credentials", label: "Credentials & clearances", domain: "credentialing", roles: CREDENTIAL_ROLES, keywords: ["licenses", "expiring"] },
  { path: "/app/background-checks", label: "Background checks", domain: "credentialing", roles: CREDENTIAL_ROLES, keywords: ["screening", "clearance"] },
  { path: "/app/exclusion-screening", label: "Exclusion screening", domain: "credentialing", roles: CREDENTIAL_ROLES, keywords: ["sam", "oig", "screening"] },
  { path: "/app/schedule", label: "Schedule", domain: "scheduling", roles: ORG_MANAGERS, keywords: ["shifts", "coverage"] },
  { path: "/trainer/classes", label: "In-service classes", domain: "training", roles: ["trainer", "org_admin", "facility_manager"], keywords: ["class", "kiosk", "attendance"] },
  { path: "/trainer/retraining", label: "Retraining monitor", domain: "training", roles: TRAINER_ONLY, keywords: ["med admin", "recertification"] },
  { path: "/app/residents", label: "Residents", domain: "residents", roles: REPORTING_ROLES, keywords: ["resident records", "assessment"] },
  { path: "/app/resident-compliance", label: "Resident compliance", domain: "residents", roles: REPORTING_ROLES, keywords: ["assessments", "care"] },
  { path: "/app/inspections", label: "Inspections & equipment", domain: "compliance", roles: INSPECTION_ROLES, keywords: ["fire drill", "equipment", "physical plant"] },
  { path: "/app/incidents", label: "Incidents & complaints", domain: "compliance", roles: REPORTING_ROLES, keywords: ["complaints", "events"] },
  { path: "/app/violations", label: "Violations & POCs", domain: "compliance", roles: REPORTING_ROLES, keywords: ["dhs", "plan of correction"] },
  { path: "/app/alerts", label: "Alerts", domain: "compliance", roles: ORG_ROLES, keywords: ["risk", "overdue"] },
  { path: "/app/pending-approvals", label: "Pending approvals", domain: "compliance", roles: PENDING_APPROVAL_ROLES, keywords: ["review", "approval", "external certificates"] },
  { path: "/app/reports", label: "Reports", domain: "documents", roles: REPORTING_ROLES, keywords: ["analytics", "exports"] },
  { path: "/app/inspection-readiness", label: "Inspection readiness", domain: "compliance", roles: REPORTING_ROLES, keywords: ["survey", "audit"] },
  { path: "/app/compliance-binder", label: "Compliance binder", domain: "documents", roles: REPORTING_ROLES, keywords: ["evidence", "packet"] },
  { path: "/app/policy-documents", label: "Policies & procedures", domain: "documents", roles: REPORTING_ROLES, keywords: ["attestation", "campaigns"] },
  { path: "/app/template-documents", label: "Template documents", domain: "documents", roles: REPORTING_ROLES, keywords: ["forms", "reference"] },
  { path: "/app/documents", label: "Documents", domain: "documents", roles: ORG_ROLES, keywords: ["files", "uploads"] },
  { path: "/app/users", label: "Users", domain: "tenant", roles: ORG_MANAGERS, keywords: ["roles", "invites"] },
  { path: "/app/settings", label: "Settings", domain: "tenant", roles: ORG_MANAGERS, keywords: ["configuration", "organization"] },
  { path: "/app/enterprise", label: "Enterprise foundation", domain: "tenant", roles: ORG_ADMINS, keywords: ["workforce", "compliance profiles", "sso", "scim", "entitlements", "integrations"] },
  { path: "/app/workforce-operations", label: "Workforce operations", domain: "credentialing", roles: ORG_MANAGERS, keywords: ["hris", "qualification", "credential renewal", "eligibility", "shift swap", "waitlist"] },
  { path: "/app/governed-learning", label: "Governed learning", domain: "training", roles: ORG_MANAGERS, keywords: ["content review", "policy lifecycle", "scorm", "xapi", "adaptive", "offline"] },
  { path: "/app/closed-loop-compliance", label: "Closed-loop compliance", domain: "compliance", roles: REPORTING_ROLES, keywords: ["remediation", "incident intake", "move in", "historical report", "evidence room", "auditor"] },
  { path: "/app/audit", label: "Audit log", domain: "platform", roles: AUDIT_LOG_ROLES, keywords: ["activity", "history"] },
  { path: "/app/help", label: "Help center", domain: "support", roles: ORG_ROLES, keywords: ["support", "articles"] },

  { path: "/trainer", label: "Trainer dashboard", domain: "training", roles: TRAINER_ONLY, keywords: ["classes", "training"] },
  { path: "/trainer/facilities", label: "Trainer facilities", domain: "directory", roles: TRAINER_ONLY, keywords: ["locations", "sites"] },
  { path: "/trainer/employees", label: "Trainer employees", domain: "directory", roles: TRAINER_ONLY, keywords: ["learners", "roster"] },

  { path: "/me", label: "My dashboard", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["home", "tasks"] },
  { path: "/me/courses", label: "My courses", domain: "self_service", roles: ANY_ROLE, keywords: ["learning", "assignments"] },
  { path: "/me/trainings", label: "My trainings", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["records", "requirements"] },
  { path: "/me/schedule", label: "My schedule", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["shifts", "calendar"] },
  { path: "/me/certificates", label: "My certificates", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["proof", "download"] },
  { path: "/me/documents", label: "My documents", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["files", "uploads"] },
  { path: "/me/credentials", label: "My credentials", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["clearances", "licenses"] },
  { path: "/me/attestations", label: "My attestations", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["policies", "sign"] },
  { path: "/me/help", label: "My help center", domain: "support", roles: EMPLOYEE_ONLY, keywords: ["support", "tickets"] },
];

const APP_PAGES_BY_PATH = new Map(APP_PAGES.map((page) => [page.path, page]));
const APP_PAGES_LONGEST_FIRST = [...APP_PAGES].sort((a, b) => b.path.length - a.path.length);

function splitPathSuffix(path: string): [pathname: string, suffix: string] {
  const match = path.match(/^([^?#]*)(.*)$/);
  return [match?.[1] || "/", match?.[2] || ""];
}

export function pagesForRole(role: Role | undefined): AppPageDefinition[] {
  if (!role) return [];
  return APP_PAGES.filter((page) => page.roles.includes(role));
}

export function canViewPage(path: string, role: Role | undefined): boolean {
  if (!role) return false;
  return APP_PAGES_BY_PATH.get(path)?.roles.includes(role) ?? false;
}

export function helpBasePathForRole(role: Role | undefined): "/app" | "/me" | null {
  if (!role || role === "platform_admin") return null;
  return role === "employee" ? "/me" : "/app";
}

export function homePathForRole(role: Role | undefined): "/admin" | "/app" | "/trainer" | "/me" | null {
  if (!role) return null;
  if (role === "platform_admin") return "/admin";
  if (role === "trainer") return "/trainer";
  if (role === "employee") return "/me";
  return "/app";
}

export function canonicalHelpPathForRole(path: string, role: Role | undefined): string {
  const helpBase = helpBasePathForRole(role);
  if (!helpBase) return path;
  const [pathname, suffix] = splitPathSuffix(path);
  if (pathname === "/app/help" || pathname.startsWith("/app/help/")) return `${helpBase}${pathname.slice("/app".length)}${suffix}`;
  if (pathname === "/me/help" || pathname.startsWith("/me/help/")) return `${helpBase}${pathname.slice("/me".length)}${suffix}`;
  return path;
}

function canonicalNavigationPathForRole(path: string, role: Role | undefined): string {
  const helpPath = canonicalHelpPathForRole(path, role);
  if (role !== "trainer") return helpPath;

  const [pathname, suffix] = splitPathSuffix(helpPath);
  if (pathname === "/app") return `/trainer${suffix}`;
  if (pathname === "/app/facilities" || pathname.startsWith("/app/facilities/")) {
    return `/trainer/facilities${pathname.slice("/app/facilities".length)}${suffix}`;
  }
  if (pathname === "/app/employees" || pathname.startsWith("/app/employees/")) {
    return `/trainer/employees${pathname.slice("/app/employees".length)}${suffix}`;
  }
  return helpPath;
}

export function canViewPath(path: string, role: Role | undefined): boolean {
  if (!role) return false;
  const canonicalPath = canonicalHelpPathForRole(path, role);
  const [pathname] = splitPathSuffix(canonicalPath);
  const page = APP_PAGES_LONGEST_FIRST.find(
    (candidate) => pathname === candidate.path || pathname.startsWith(`${candidate.path}/`),
  );
  return page?.roles.includes(role) ?? false;
}

export function safePathForRole(path: string, role: Role | undefined): string | null {
  if (!role) return null;
  const canonicalPath = canonicalNavigationPathForRole(path, role);
  return canViewPath(canonicalPath, role) ? canonicalPath : homePathForRole(role);
}

export function searchPages(query: string, role: Role | undefined): AppPageDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q || !role) return [];
  return pagesForRole(role)
    .filter((page) =>
      [page.label, page.domain, page.path, ...page.keywords].some((value) => value.toLowerCase().includes(q)),
    )
    .slice(0, 6);
}

export function commandActionsForRole(role: Role | undefined): AppCommandAction[] {
  if (!role) return [];
  return APP_COMMAND_ACTIONS.filter((action) => action.roles.includes(role));
}

export function searchCommandActions(query: string, role: Role | undefined): AppCommandAction[] {
  const q = query.trim().toLowerCase();
  if (!q || !role) return [];
  return commandActionsForRole(role)
    .filter((action) =>
      [action.label, action.description, action.domain, action.path, ...action.keywords].some((value) =>
        value.toLowerCase().includes(q),
      ),
    )
    .slice(0, 5);
}
