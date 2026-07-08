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

const PLATFORM_ADMIN: Role[] = ["platform_admin"];
const ORG_ROLES: Role[] = ["org_admin", "facility_manager", "trainer", "auditor"];
const ORG_MANAGERS: Role[] = ["org_admin", "facility_manager"];
const REPORTING_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const CREDENTIAL_ROLES: Role[] = ["org_admin", "facility_manager", "auditor"];
const SUPPORT_ROLES: Role[] = ["org_admin", "facility_manager", "trainer", "auditor", "employee"];
const ANY_ROLE: Role[] = ["platform_admin", "org_admin", "facility_manager", "trainer", "employee", "auditor"];

export const APP_PAGES: AppPageDefinition[] = [
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
  { path: "/admin/security", label: "Security & governance", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["roles", "audit", "access"] },
  { path: "/admin/support-tickets", label: "Support tickets", domain: "support", roles: PLATFORM_ADMIN, keywords: ["help", "queue"] },
  { path: "/admin/help-content", label: "Help center content", domain: "support", roles: PLATFORM_ADMIN, keywords: ["articles", "knowledge base"] },
  { path: "/admin/settings", label: "Platform settings", domain: "platform", roles: PLATFORM_ADMIN, keywords: ["feature flags", "maintenance", "signup"] },

  { path: "/app", label: "Organization dashboard", domain: "tenant", roles: ORG_ROLES, keywords: ["overview", "compliance"] },
  { path: "/app/facilities", label: "Facilities", domain: "directory", roles: ORG_ROLES, keywords: ["locations", "sites"] },
  { path: "/app/employees", label: "Employees", domain: "directory", roles: ORG_ROLES, keywords: ["staff", "workforce"] },
  { path: "/app/training-matrix", label: "Training matrix", domain: "training", roles: ORG_ROLES, keywords: ["compliance", "due soon"] },
  { path: "/app/courses", label: "Courses", domain: "training", roles: ORG_ROLES, keywords: ["catalog", "lessons"] },
  { path: "/app/course-assignments", label: "Course assignments", domain: "training", roles: ORG_ROLES, keywords: ["assign", "learners"] },
  { path: "/app/training-plans", label: "Training plans", domain: "training", roles: ORG_ROLES, keywords: ["paths", "requirements"] },
  { path: "/app/competency-templates", label: "Competency templates", domain: "competency", roles: ORG_ROLES, keywords: ["skills", "evaluations"] },
  { path: "/app/competency-records", label: "Competency records", domain: "competency", roles: ORG_ROLES, keywords: ["evaluations", "skills"] },
  { path: "/app/credentials", label: "Credentials & clearances", domain: "credentialing", roles: CREDENTIAL_ROLES, keywords: ["licenses", "expiring"] },
  { path: "/app/background-checks", label: "Background checks", domain: "credentialing", roles: CREDENTIAL_ROLES, keywords: ["screening", "clearance"] },
  { path: "/app/exclusion-screening", label: "Exclusion screening", domain: "credentialing", roles: CREDENTIAL_ROLES, keywords: ["sam", "oig", "screening"] },
  { path: "/app/schedule", label: "Schedule", domain: "scheduling", roles: ORG_MANAGERS, keywords: ["shifts", "coverage"] },
  { path: "/trainer/classes", label: "In-service classes", domain: "training", roles: ["trainer", "org_admin", "facility_manager"], keywords: ["class", "kiosk", "attendance"] },
  { path: "/trainer/retraining", label: "Retraining monitor", domain: "training", roles: ["trainer", "org_admin", "facility_manager"], keywords: ["med admin", "recertification"] },
  { path: "/app/residents", label: "Residents", domain: "residents", roles: REPORTING_ROLES, keywords: ["resident records", "assessment"] },
  { path: "/app/resident-compliance", label: "Resident compliance", domain: "residents", roles: REPORTING_ROLES, keywords: ["assessments", "care"] },
  { path: "/app/incidents", label: "Incidents & complaints", domain: "compliance", roles: REPORTING_ROLES, keywords: ["complaints", "events"] },
  { path: "/app/violations", label: "Violations & POCs", domain: "compliance", roles: REPORTING_ROLES, keywords: ["dhs", "plan of correction"] },
  { path: "/app/alerts", label: "Alerts", domain: "compliance", roles: ORG_ROLES, keywords: ["risk", "overdue"] },
  { path: "/app/pending-approvals", label: "Pending approvals", domain: "compliance", roles: ORG_MANAGERS, keywords: ["review", "approval"] },
  { path: "/app/reports", label: "Reports", domain: "documents", roles: REPORTING_ROLES, keywords: ["analytics", "exports"] },
  { path: "/app/inspection-readiness", label: "Inspection readiness", domain: "compliance", roles: REPORTING_ROLES, keywords: ["survey", "audit"] },
  { path: "/app/compliance-binder", label: "Compliance binder", domain: "documents", roles: REPORTING_ROLES, keywords: ["evidence", "packet"] },
  { path: "/app/policy-documents", label: "Policies & procedures", domain: "documents", roles: REPORTING_ROLES, keywords: ["attestation", "campaigns"] },
  { path: "/app/template-documents", label: "Template documents", domain: "documents", roles: REPORTING_ROLES, keywords: ["forms", "reference"] },
  { path: "/app/documents", label: "Documents", domain: "documents", roles: ORG_ROLES, keywords: ["files", "uploads"] },
  { path: "/app/users", label: "Users", domain: "tenant", roles: ORG_MANAGERS, keywords: ["roles", "invites"] },
  { path: "/app/settings", label: "Settings", domain: "tenant", roles: ORG_MANAGERS, keywords: ["configuration", "organization"] },
  { path: "/app/help", label: "Help center", domain: "support", roles: SUPPORT_ROLES, keywords: ["support", "articles"] },

  { path: "/me", label: "My dashboard", domain: "self_service", roles: ["employee"], keywords: ["home", "tasks"] },
  { path: "/me/courses", label: "My courses", domain: "self_service", roles: ANY_ROLE, keywords: ["learning", "assignments"] },
  { path: "/me/trainings", label: "My trainings", domain: "self_service", roles: ["employee"], keywords: ["records", "requirements"] },
  { path: "/me/schedule", label: "My schedule", domain: "self_service", roles: ["employee"], keywords: ["shifts", "calendar"] },
  { path: "/me/certificates", label: "My certificates", domain: "self_service", roles: ["employee"], keywords: ["proof", "download"] },
  { path: "/me/credentials", label: "My credentials", domain: "self_service", roles: ["employee"], keywords: ["clearances", "licenses"] },
  { path: "/me/attestations", label: "My attestations", domain: "self_service", roles: ["employee"], keywords: ["policies", "sign"] },
  { path: "/me/help", label: "My help center", domain: "support", roles: SUPPORT_ROLES, keywords: ["support", "tickets"] },
];

export function pagesForRole(role: Role | undefined): AppPageDefinition[] {
  if (!role) return [];
  return APP_PAGES.filter((page) => page.roles.includes(role));
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
