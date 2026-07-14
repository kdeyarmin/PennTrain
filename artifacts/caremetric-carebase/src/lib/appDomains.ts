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
const MAINTENANCE_ROLES: Role[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "auditor"];
const AUDIT_LOG_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const PENDING_APPROVAL_ROLES: Role[] = ["org_admin", "facility_manager", "trainer"];
const WORK_QUEUE_ROLES: Role[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
const EMERGENCY_ROLES: Role[] = ["platform_admin", "org_admin", "facility_manager", "auditor"];
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
    id: "assign-training",
    label: "Assign training",
    description: "Open training assignments to assign or review employee work.",
    path: "/app/course-assignments",
    domain: "training",
    roles: ORG_ROLES,
    keywords: ["training assignment", "employees", "training", "remediation"],
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
    label: "Create AI training content",
    description: "Draft new training content from source material in the AI training builder.",
    path: "/admin/courses/new-ai",
    domain: "training",
    roles: PLATFORM_ADMIN,
    keywords: ["generate training", "training builder", "curriculum", "ai"],
  },
  {
    id: "state-form-document-analyzer",
    label: "Preview state form analyzer prototype",
    description: "Explore the simulated review workflow; no OCR or durable processing occurs.",
    path: "/admin/document-analyzer",
    domain: "documents",
    roles: PLATFORM_ADMIN,
    keywords: ["pdf", "state forms", "handwriting", "ocr", "backlog", "ai", "prototype", "simulation"],
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
  { path: "/account/notifications", label: "Notification settings", domain: "self_service", roles: ANY_ROLE, keywords: ["sms", "email", "phone", "consent", "preferences", "text", "reminders"] },
  { path: "/admin", label: "Platform dashboard", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["super admin", "command center", "health"] },
  { path: "/admin/organizations", label: "Organizations", domain: "tenant", roles: PLATFORM_ADMIN, keywords: ["tenant", "customer", "subscription"] },
  { path: "/admin/packages", label: "Packages", domain: "tenant", roles: PLATFORM_ADMIN, keywords: ["plans", "subscriptions", "billing"] },
  { path: "/admin/facilities", label: "All facilities", domain: "directory", roles: PLATFORM_ADMIN, keywords: ["locations", "sites"] },
  { path: "/admin/employees", label: "All employees", domain: "directory", roles: PLATFORM_ADMIN, keywords: ["staff", "workforce"] },
  { path: "/admin/users", label: "Platform users", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["access", "roles", "invites"] },
  { path: "/admin/courses", label: "Training content catalog", domain: "training", roles: PLATFORM_ADMIN, keywords: ["training", "content"] },
  { path: "/admin/courses/new-ai", label: "AI training builder", domain: "training", roles: PLATFORM_ADMIN, keywords: ["generate", "curriculum", "authoring"] },
  { path: "/admin/ai-generations", label: "AI generation log", domain: "training", roles: PLATFORM_ADMIN, keywords: ["ai", "failures", "cost"] },
  { path: "/admin/training-plans", label: "Training plans", domain: "training", roles: PLATFORM_ADMIN, keywords: ["paths", "requirements", "curriculum"] },
  { path: "/admin/document-analyzer", label: "State form document analyzer prototype", domain: "documents", roles: PLATFORM_ADMIN, keywords: ["pdf", "forms", "handwriting", "ocr", "state", "backlog", "ai", "prototype", "simulation"] },
  { path: "/admin/incidents/:id", label: "Platform incident detail", domain: "compliance", roles: PLATFORM_ADMIN, keywords: ["incident", "complaint", "event"] },
  { path: "/admin/inspections/:id", label: "Platform inspection item detail", domain: "compliance", roles: PLATFORM_ADMIN, keywords: ["inspection", "equipment", "physical plant"] },
  { path: "/admin/residents/:id", label: "Resident chart", domain: "residents", roles: PLATFORM_ADMIN, keywords: ["resident", "chart", "assessment", "state form"] },
  { path: "/admin/residents/:residentId/assessment-forms/:formId", label: "Platform resident assessment form", domain: "residents", roles: PLATFORM_ADMIN, keywords: ["resident", "assessment", "rasp", "asp", "state form"] },
  { path: "/admin/quizzes/:quizId", label: "Quiz builder", domain: "training", roles: PLATFORM_ADMIN, keywords: ["quiz", "questions", "assessment", "authoring"] },
  { path: "/admin/alerts", label: "Platform alerts", domain: "compliance", roles: PLATFORM_ADMIN, keywords: ["risk", "overdue"] },
  { path: "/admin/audit", label: "Platform audit log", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["governance", "activity"] },
  { path: "/admin/notifications", label: "Notification delivery", domain: "support", roles: PLATFORM_ADMIN, keywords: ["email", "sms", "failed"] },
  { path: "/admin/system-jobs", label: "System jobs", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["cron", "queue", "health", "freshness", "retry"] },
  { path: "/admin/enterprise", label: "Enterprise foundation", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["portfolio", "regions", "workforce", "rules", "sso", "scim", "billing", "integrations"] },
  { path: "/admin/qualified-workforce", label: "Qualified workforce operations", domain: "credentialing", roles: PLATFORM_ADMIN, keywords: ["hris", "qualification", "credential renewal", "eligibility", "shift swap", "waitlist"] },
  { path: "/admin/governed-learning", label: "Governed content", domain: "training", roles: PLATFORM_ADMIN, keywords: ["content review", "scorm", "xapi", "lti", "adaptive", "offline"] },
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
  { path: "/app/courses", label: "Training content", domain: "training", roles: ORG_ROLES, keywords: ["catalog", "lessons"] },
  { path: "/app/course-assignments", label: "Training assignments", domain: "training", roles: ORG_ROLES, keywords: ["assign", "employees"] },
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
  { path: "/app/state-forms", label: "State forms", domain: "residents", roles: REPORTING_ROLES, keywords: ["rasp", "asp", "dme", "preadmission", "annual reassessment", "dhs forms", "renewals"] },
  { path: "/app/services", label: "Resident service delivery", domain: "residents", roles: WORK_QUEUE_ROLES, keywords: ["support plan", "daily services", "refusal", "missed service", "care tasks", "service requirements"] },
  { path: "/app/admissions", label: "Admissions, census & rooms", domain: "residents", roles: WORK_QUEUE_ROLES, keywords: ["referral", "prospect", "inquiry", "room", "bed", "occupancy", "census", "move in", "admission"] },
  { path: "/app/change-of-condition", label: "Change-of-condition management", domain: "residents", roles: WORK_QUEUE_ROLES, keywords: ["fall", "hospital return", "monitoring", "provider notification", "follow up", "reassessment", "support plan review"] },
  { path: "/app/qapi", label: "QAPI & quality management", domain: "compliance", roles: WORK_QUEUE_ROLES, keywords: ["quality", "performance improvement", "five whys", "fishbone", "measurements", "audit sample", "sustainment"] },
  { path: "/app/emergency", label: "Emergency operations", domain: "compliance", roles: EMERGENCY_ROLES, keywords: ["evacuation", "accountability", "outage", "emergency plan", "relocation", "generator fuel", "mass notification", "after action"] },
  { path: "/app/inspections", label: "Inspections & equipment", domain: "compliance", roles: INSPECTION_ROLES, keywords: ["fire drill", "equipment", "physical plant"] },
  { path: "/app/maintenance", label: "Maintenance & work orders", domain: "compliance", roles: MAINTENANCE_ROLES, keywords: ["repair", "work order", "preventive maintenance", "vendor", "downtime", "qr code"] },
  { path: "/app/incidents", label: "Incidents", domain: "compliance", roles: REPORTING_ROLES, keywords: ["reportable events", "safety"] },
  { path: "/app/complaints", label: "Complaints, grievances & resident rights", domain: "compliance", roles: REPORTING_ROLES, keywords: ["complaint", "grievance", "ombudsman", "resident rights", "nonretaliation", "appeal"] },
  { path: "/app/confidential-incidents", label: "Confidential reports", domain: "compliance", roles: REPORTING_ROLES, keywords: ["safety report", "anonymous", "near miss", "intake", "whistleblower"] },
  { path: "/app/work", label: "Operational work queue", domain: "compliance", roles: WORK_QUEUE_ROLES, keywords: ["my work", "remediation", "tasks", "owners", "overdue", "approval", "dependencies"] },
  { path: "/app/violations", label: "Violations & POCs", domain: "compliance", roles: REPORTING_ROLES, keywords: ["dhs", "plan of correction"] },
  { path: "/app/alerts", label: "Alerts", domain: "compliance", roles: ORG_ROLES, keywords: ["risk", "overdue"] },
  { path: "/app/pending-approvals", label: "Pending approvals", domain: "compliance", roles: PENDING_APPROVAL_ROLES, keywords: ["review", "approval", "external certificates"] },
  { path: "/app/reports", label: "Reports", domain: "documents", roles: REPORTING_ROLES, keywords: ["analytics", "exports"] },
  { path: "/app/inspection-readiness", label: "Inspection readiness", domain: "compliance", roles: REPORTING_ROLES, keywords: ["survey", "audit"] },
  { path: "/app/pch-alr-operations", label: "PCH / ALF operations", domain: "compliance", roles: REPORTING_ROLES, keywords: ["personal care home", "assisted living", "chapter 2600", "chapter 2800", "survey", "medication safety", "resident rights", "emergency preparedness"] },
  { path: "/app/regulatory-crosswalk", label: "Regulatory crosswalk", domain: "compliance", roles: REPORTING_ROLES, keywords: ["chapter 2600", "chapter 2800", "regulation", "citation", "crosswalk", "evidence", "binder", "survey"] },
  { path: "/app/compliance-binder", label: "Compliance binder", domain: "documents", roles: REPORTING_ROLES, keywords: ["evidence", "packet"] },
  { path: "/app/evidence", label: "Evidence room", domain: "compliance", roles: REPORTING_ROLES, keywords: ["survey", "auditor", "guest access", "surveyor", "artifacts", "binder", "share"] },
  { path: "/app/policy-documents", label: "Policies & procedures", domain: "documents", roles: REPORTING_ROLES, keywords: ["attestation", "campaigns"] },
  { path: "/app/template-documents", label: "Template documents", domain: "documents", roles: REPORTING_ROLES, keywords: ["forms", "reference"] },
  { path: "/app/dhs-forms", label: "DHS forms library", domain: "documents", roles: REPORTING_ROLES, keywords: ["state forms", "official forms", "pch", "alf", "alr", "rasp", "asp", "dme", "reportable incident", "download", "pa.gov"] },
  { path: "/app/documents", label: "Documents", domain: "documents", roles: ORG_ROLES, keywords: ["files", "uploads"] },
  { path: "/app/users", label: "Users", domain: "tenant", roles: ORG_MANAGERS, keywords: ["roles", "invites"] },
  { path: "/app/settings", label: "Settings", domain: "tenant", roles: ORG_MANAGERS, keywords: ["configuration", "organization"] },
  { path: "/app/enterprise", label: "Enterprise foundation", domain: "tenant", roles: ORG_ADMINS, keywords: ["workforce", "compliance profiles", "sso", "scim", "entitlements", "integrations"] },
  { path: "/app/workforce-operations", label: "Workforce operations", domain: "credentialing", roles: ORG_MANAGERS, keywords: ["hris", "qualification", "credential renewal", "eligibility", "shift swap", "waitlist"] },
  { path: "/app/governed-learning", label: "Governed content", domain: "training", roles: ORG_MANAGERS, keywords: ["content review", "policy lifecycle", "scorm", "xapi", "adaptive", "offline"] },
  { path: "/app/closed-loop-compliance", label: "Closed-loop compliance", domain: "compliance", roles: REPORTING_ROLES, keywords: ["remediation", "incident intake", "move in", "historical report", "evidence room", "auditor"] },
  { path: "/app/audit", label: "Audit log", domain: "platform", roles: AUDIT_LOG_ROLES, keywords: ["activity", "history"] },
  { path: "/app/help", label: "Help center", domain: "support", roles: ORG_ROLES, keywords: ["support", "articles"] },

  { path: "/trainer", label: "Trainer dashboard", domain: "training", roles: TRAINER_ONLY, keywords: ["classes", "training"] },
  { path: "/trainer/facilities", label: "Trainer facilities", domain: "directory", roles: TRAINER_ONLY, keywords: ["locations", "sites"] },
  { path: "/trainer/employees", label: "Trainer employees", domain: "directory", roles: TRAINER_ONLY, keywords: ["employees", "roster"] },

  { path: "/me", label: "My dashboard", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["home", "tasks"] },
  { path: "/me/courses", label: "My training assignments", domain: "self_service", roles: ANY_ROLE, keywords: ["training", "assignments"] },
  { path: "/me/trainings", label: "My training records", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["records", "requirements"] },
  { path: "/me/work", label: "My work", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["tasks", "remediation", "assigned", "due"] },
  { path: "/me/schedule", label: "My schedule", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["shifts", "calendar"] },
  { path: "/me/services", label: "My services", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["resident services", "support plan", "tasks", "refusal", "completion"] },
  { path: "/me/change-of-condition", label: "My change follow-ups", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["resident change", "monitoring", "follow up", "observations", "supervisor"] },
  { path: "/me/certificates", label: "My certificates", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["proof", "download"] },
  { path: "/me/documents", label: "My documents", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["files", "uploads"] },
  { path: "/me/credentials", label: "My credentials", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["clearances", "licenses"] },
  { path: "/me/attestations", label: "My attestations", domain: "self_service", roles: EMPLOYEE_ONLY, keywords: ["policies", "sign"] },
  { path: "/me/help", label: "My help center", domain: "support", roles: EMPLOYEE_ONLY, keywords: ["support", "tickets"] },
];

const APP_PAGES_BY_PATH = new Map(APP_PAGES.map((page) => [page.path, page]));
const APP_PAGES_LONGEST_FIRST = [...APP_PAGES].sort((a, b) => b.path.length - a.path.length);
function routePathMatcher(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((segment) => segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const APP_PAGE_ROUTE_MATCHERS = APP_PAGES_LONGEST_FIRST.map((page) => ({
  page,
  matcher: page.path.includes(":") ? routePathMatcher(page.path) : null,
}));

// Only these index pages own detail/subresource routes in App.tsx. Keeping this as an explicit
// allow-list prevents unrelated settings/dashboard pages from authorizing arbitrary descendants
// such as /app/settings/not-real while still letting stored detail links canonicalize correctly.
const NESTED_PAGE_OWNER_PATHS = new Set([
  "/admin/organizations",
  "/admin/facilities",
  "/admin/employees",
  "/admin/courses",
  "/admin/support-tickets",
  "/app/facilities",
  "/app/employees",
  "/app/courses",
  "/app/policy-documents",
  "/app/template-documents",
  "/app/incidents",
  "/app/complaints",
  "/app/confidential-incidents",
  "/app/work",
  "/app/evidence",
  "/app/violations",
  "/app/residents",
  "/app/admissions",
  "/app/change-of-condition",
  "/app/qapi",
  "/app/emergency",
  "/app/inspections",
  "/app/maintenance",
  "/app/help",
  "/app/schedule",
  "/trainer/classes",
  "/trainer/facilities",
  "/trainer/employees",
  "/me/courses",
  "/me/work",
  "/me/change-of-condition",
  "/me/help",
]);

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
  const match = APP_PAGE_ROUTE_MATCHERS.find(({ page: candidate, matcher }) => {
    if (matcher) return matcher.test(pathname);
    if (pathname === candidate.path) return true;

    // Detail/subresource routes are intentionally represented by their owning index page in
    // APP_PAGES (for example /app/employees owns /app/employees/:id and /app/help owns
    // /app/help/tickets/:id). Do not let pages without known descendants match arbitrary
    // malformed URLs, though -- safePathForRole() must reject stale/bad links instead of treating
    // every path under a visible page as authorized.
    return NESTED_PAGE_OWNER_PATHS.has(candidate.path) && pathname.startsWith(`${candidate.path}/`);
  });
  const page = match?.page;
  return page?.roles.includes(role) ?? false;
}

export function safePathForRole(path: string, role: Role | undefined): string | null {
  if (!role) return null;
  const canonicalPath = canonicalNavigationPathForRole(path, role);
  return canViewPath(canonicalPath, role) ? canonicalPath : homePathForRole(role);
}

export function viewablePathForRole(path: string, role: Role | undefined): string | null {
  if (!role) return null;
  const canonicalPath = canonicalNavigationPathForRole(path, role);
  return canViewPath(canonicalPath, role) ? canonicalPath : null;
}

export function searchPages(query: string, role: Role | undefined): AppPageDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q || !role) return [];
  return pagesForRole(role)
    .filter((page) => !page.path.includes(":"))
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
