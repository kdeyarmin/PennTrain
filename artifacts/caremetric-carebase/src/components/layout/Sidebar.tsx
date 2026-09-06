import React, { useEffect, useState } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { canViewPath } from "@/lib/appDomains";
import { useProductModuleAccess } from "@/lib/productModuleAccess";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
import { useGetOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { useNavigationWorkspace } from "@/hooks/useProductExperience";
import { useOrgFeatureEnabled } from "@/hooks/useFeatureRelease";
import { useToast } from "@/hooks/use-toast";
import { PCH_ALR_ONLY_FACILITY_TYPES, hasAnyFacilityType } from "@/lib/facilityTypes";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { AuthUser } from "@/lib/auth";
import { LogoMark, BrandName } from "@/components/brand/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Building2,
  Users,
  Grid,
  FileCheck,
  Bell,
  BarChart3,
  Files,
  Settings,
  CreditCard,
  ShieldAlert,
  GraduationCap,
  ShieldCheck,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  Package,
  ClipboardCheck,
  ListChecks,
  ClipboardList,
  AlertTriangle,
  Flame,
  Wrench,
  Pill,
  FileSignature,
  ShieldQuestion,
  Radar,
  Crosshair,
  Gavel,
  BookOpen,
  BookCheck,
  BedDouble,
  FileStack,
  Sparkles,
  Send,
  Sliders,
  Eye,
  CalendarDays,
  LifeBuoy,
  HelpCircle,
  Search,
  ChevronDown,
  Rocket,
  Flag,
  Star,
  Activity,
  Network,
  UserRoundCheck,
  FolderLock,
  ScanText,
  FileSearch,
  MessageSquareWarning,
  Utensils,
  Landmark,
  Siren,
  HeartPulse,
  History,
  Gauge,
  ScrollText,
  Printer,
  FileUp,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { title?: string; items: NavItem[] };

function getNavSections(
  role: AuthUser["role"],
  showPchAlrModules: boolean,
  showSurveyDay: boolean,
): NavSection[] {
  if (role === "platform_admin") {
    return [
      {
        items: [
          { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
        ]
      },
      {
        title: "Tenants",
        items: [
          { href: "/admin/organizations", label: "Organizations", icon: Building2 },
          { href: "/admin/packages", label: "Packages", icon: Package },
        ]
      },
      {
        title: "Directory",
        items: [
          { href: "/admin/facilities", label: "Facilities", icon: Grid },
          { href: "/admin/employees", label: "Employees", icon: Users },
          { href: "/admin/users", label: "Users", icon: Users },
        ]
      },
      {
        title: "Content Studio",
        items: [
          { href: "/admin/courses", label: "Courses", icon: GraduationCap },
          { href: "/admin/courses/new-ai", label: "AI Course Builder", icon: Sparkles },
          { href: "/admin/training-plans", label: "Training Plans", icon: ListChecks },
          { href: "/admin/ai-generations", label: "AI Generation Log", icon: BarChart3 },
          { href: "/admin/document-analyzer", label: "Document Analyzer", icon: ScanText },
          { href: "/admin/help-content", label: "Help Center Content", icon: HelpCircle },
          { href: "/admin/regulatory-updates", label: "Regulatory Updates", icon: ScrollText },
        ]
      },
      {
        title: "My Learning",
        items: [
          { href: "/me/courses", label: "My Training", icon: BookOpen },
        ]
      },
      {
        title: "Oversight",
        items: [
          { href: "/admin/alerts", label: "Alerts", icon: Bell },
          { href: "/app/work", label: "Operational Work", icon: ClipboardList },
          { href: "/app/services", label: "Resident Services", icon: CalendarDays },
          { href: "/app/resident-care-delivery", label: "Care Delivery", icon: HeartPulse },
          { href: "/app/admissions", label: "Admissions & Census", icon: BedDouble },
          { href: "/app/change-of-condition", label: "Change Follow-Up", icon: Activity },
          ...(showPchAlrModules ? [{ href: "/app/dietary-operations", label: "Dietary & Food Safety", icon: Utensils }] : []),
          ...(showPchAlrModules ? [{ href: "/app/resident-services-calendar", label: "Resident Calendar", icon: CalendarDays }] : []),
          ...(showPchAlrModules ? [{ href: "/app/resident-finance", label: "Resident Finance", icon: Landmark }] : []),
          ...(showPchAlrModules ? [{ href: "/app/medication-integration", label: "Medication Integration", icon: Pill }] : []),
          { href: "/app/qapi", label: "QAPI & Quality", icon: BarChart3 },
          { href: "/admin/audit", label: "Audit Log", icon: ShieldAlert },
          { href: "/admin/notifications", label: "Notification Delivery", icon: Send },
          { href: "/admin/system-jobs", label: "System Jobs", icon: Activity },
          { href: "/admin/enterprise", label: "Enterprise Foundation", icon: Network },
          { href: "/admin/qualified-workforce", label: "Qualified Workforce", icon: UserRoundCheck },
          { href: "/admin/governed-learning", label: "Governed Content", icon: BookCheck },
          { href: "/admin/closed-loop-compliance", label: "Closed-Loop Compliance", icon: Gavel },
          ...(showPchAlrModules ? [{ href: "/admin/regulatory-copilot", label: "Regulatory Copilot", icon: Sparkles }] : []),
          { href: "/admin/security", label: "Security & Governance", icon: Eye },
          { href: "/admin/support-tickets", label: "Support Tickets", icon: LifeBuoy },
        ]
      },
      {
        title: "Platform",
        items: [
          { href: "/admin/settings", label: "Settings", icon: Sliders },
          { href: "/admin/release-flags", label: "Release flags", icon: Flag },
          { href: "/admin/roadmap", label: "Improvement Roadmap", icon: Rocket },
        ]
      }
    ];
  } else if (role === "org_admin" || role === "facility_manager") {
    // Workflow IA: daily work first (Today only), then People / Training / Credentials /
    // Residents / Safety & survey. Advanced tools + admin collapse by default via section titles
    // users already pin/collapse. The scorecard is reached from Today, not as a first-level peer.
    return [
      {
        items: [
          { href: "/app/today", label: "Today", icon: Activity },
        ]
      },
      {
        title: "Start here",
        items: [
          { href: "/app/employees?action=add", label: "Onboard employee", icon: Users },
          { href: "/app/report-event", label: "Report an event", icon: Siren },
          { href: "/app/data-imports", label: "Import & migration", icon: FileUp },
          { href: "/app/alerts", label: "Resolve risks", icon: ShieldAlert },
          ...(showPchAlrModules
            ? [
                { href: "/app/inspection-readiness", label: "Inspection readiness", icon: Radar },
                ...(showSurveyDay
                  ? [{ href: "/app/survey-day", label: "Survey Day", icon: ShieldCheck }]
                  : []),
              ]
            : []),
        ],
      },
      {
        title: "People",
        items: [
          { href: "/app/facilities", label: "Facilities", icon: Building2 },
          { href: "/app/employees", label: "Employees", icon: Users },
          { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
          { href: "/app/workforce-operations", label: "Workforce operations", icon: UserRoundCheck },
          { href: "/app/employee-lifecycle", label: "Lifecycle cases", icon: Users },
          { href: "/app/invitations", label: "Invitations", icon: Send },
          ...(showPchAlrModules ? [{ href: "/app/shift-handoffs", label: "Shift handoffs", icon: ClipboardList }] : []),
        ]
      },
      {
        title: "Training",
        items: [
          { href: "/app/training-matrix", label: "Training matrix", icon: Grid },
          { href: "/app/courses", label: "Training content", icon: GraduationCap },
          { href: "/app/course-assignments", label: "Assignments", icon: FileCheck },
          { href: "/trainer/classes", label: "In-service classes", icon: GraduationCap },
          { href: "/app/training-plans", label: "Training plans", icon: ListChecks },
          { href: "/app/pending-approvals", label: "Pending approvals", icon: ClipboardCheck },
          { href: "/me/courses", label: "My training", icon: BookOpen },
        ]
      },
      {
        title: "Credentials",
        items: [
          { href: "/app/credentials", label: "Credentials & clearances", icon: ShieldCheck },
          { href: "/app/background-checks", label: "Background checks", icon: ShieldQuestion },
          ...(showPchAlrModules ? [{ href: "/app/med-admin-roster", label: "Who can pass meds", icon: Pill }] : []),
          { href: "/app/competency-records", label: "Competency records", icon: ClipboardCheck },
          { href: "/app/competency-templates", label: "Competency templates", icon: ClipboardList },
          ...(showPchAlrModules ? [{ href: "/app/practicums", label: "Practicums", icon: FileCheck }] : []),
          ...(showPchAlrModules ? [{ href: "/app/administrator-qualification", label: "Administrator qualification", icon: GraduationCap }] : []),
        ]
      },
      ...(showPchAlrModules ? [{
        title: "Residents & care",
        items: [
          { href: "/app/residents", label: "Residents", icon: BedDouble },
          { href: "/app/admissions", label: "Admissions & census", icon: ClipboardCheck },
          { href: "/app/services", label: "Resident services", icon: CalendarDays },
          { href: "/app/resident-care-delivery", label: "Care delivery", icon: HeartPulse },
          { href: "/app/change-of-condition", label: "Change follow-up", icon: Activity },
          { href: "/app/dietary-operations", label: "Dietary & food safety", icon: Utensils },
          { href: "/app/resident-services-calendar", label: "Resident calendar", icon: CalendarDays },
          { href: "/app/medication-integration", label: "Medication integration", icon: Pill },
          { href: "/app/state-forms", label: "State forms", icon: ClipboardList },
          { href: "/app/resident-finance", label: "Resident finance", icon: Landmark },
          { href: "/app/qapi", label: "QAPI & quality", icon: BarChart3 },
        ]
      }] : []),
      {
        title: "Safety & survey",
        items: [
          { href: "/app/report-event", label: "Report an event", icon: Siren },
          { href: "/app/incidents", label: "Incidents", icon: AlertTriangle },
          { href: "/app/complaints", label: "Complaints & grievances", icon: MessageSquareWarning },
          { href: "/app/confidential-incidents", label: "Confidential reports", icon: ShieldAlert },
          { href: "/app/work", label: "Work queue", icon: ClipboardList },
          { href: "/app/violations", label: "Violations & POCs", icon: Gavel },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
          ...(showPchAlrModules ? [{ href: "/app/inspections", label: "Inspections & equipment", icon: Flame }] : []),
          ...(showPchAlrModules ? [{ href: "/app/emergency", label: "Emergency operations", icon: Siren }] : []),
          ...(showPchAlrModules ? [{ href: "/app/maintenance", label: "Maintenance", icon: Wrench }] : []),
          ...(showPchAlrModules ? [{ href: "/app/inspection-readiness", label: "Inspection readiness", icon: Radar }] : []),
          ...(showPchAlrModules && showSurveyDay ? [{ href: "/app/survey-day", label: "Survey Day", icon: ShieldCheck }] : []),
          { href: "/app/compliance-binder", label: "Compliance binder", icon: Files },
          { href: "/app/evidence", label: "Documentation room", icon: FolderLock },
          { href: "/app/reports", label: "Reports", icon: BarChart3 },
        ]
      },
      {
        title: "Advanced",
        items: [
          { href: "/app", label: "Compliance scorecard", icon: LayoutDashboard },
          { href: "/app/compliance-command-center", label: "Command Center", icon: ShieldCheck },
          { href: "/app/closed-loop-compliance", label: "Closed-loop compliance", icon: Gavel },
          { href: "/app/value-center", label: "Value Center", icon: Gauge },
          { href: "/app/reports/comprehensive", label: "Comprehensive report", icon: Printer },
          ...(showPchAlrModules ? [{ href: "/app/survey-rehearsals", label: "Survey rehearsal", icon: Crosshair }] : []),
          ...(showPchAlrModules ? [{ href: "/app/pch-alr-operations", label: "PCH / ALF operations", icon: Crosshair }] : []),
          ...(showPchAlrModules ? [{ href: "/app/regulatory-crosswalk", label: "Regulatory crosswalk", icon: FileSearch }] : []),
          ...(showPchAlrModules ? [{ href: "/app/regulatory-copilot", label: "Regulatory copilot", icon: Sparkles }] : []),
          { href: "/app/policy-documents", label: "Policies & procedures", icon: FileSignature },
          { href: "/app/template-documents", label: "Template documents", icon: FileStack },
          { href: "/app/dhs-forms", label: "DHS forms library", icon: Landmark },
          { href: "/app/documents", label: "Documents", icon: Files },
          { href: "/app/governed-learning", label: "Governed content", icon: BookCheck },
        ]
      },
      {
        title: "Admin",
        items: [
          { href: "/app/users", label: "Users", icon: Users },
          { href: "/app/training-types", label: "Training types", icon: ListChecks },
          { href: "/app/settings", label: "Settings", icon: Settings },
          ...(role === "org_admin"
            ? [
              { href: "/app/billing", label: "Billing & plans", icon: CreditCard },
              { href: "/app/enterprise", label: "Enterprise foundation", icon: Network },
            ]
            : []),
          ...(["org_admin", "facility_manager"].includes(role ?? "")
            ? [{ href: "/app/audit", label: "Audit log", icon: ShieldAlert }]
            : []),
          { href: "/app/help", label: "Help center", icon: HelpCircle },
        ]
      },
    ];
  } else if (role === "auditor") {
    return [
      {
        items: [
          { href: "/app/today", label: "Today", icon: Activity },
        ]
      },
      {
        title: "Directory",
        items: [
          { href: "/app/facilities", label: "Facilities", icon: Building2 },
          { href: "/app/employees", label: "Employees", icon: Users },
          ...(showPchAlrModules ? [{ href: "/app/inspections", label: "Inspections & equipment", icon: Flame }] : []),
          ...(showPchAlrModules ? [{ href: "/app/emergency", label: "Emergency operations", icon: Siren }] : []),
          ...(showPchAlrModules ? [{ href: "/app/maintenance", label: "Maintenance", icon: Wrench }] : []),
        ]
      },
      {
        title: "Training & credentials",
        items: [
          { href: "/app/training-matrix", label: "Training matrix", icon: Grid },
          { href: "/app/course-assignments", label: "Assignments", icon: FileCheck },
          { href: "/app/training-plans", label: "Training plans", icon: ListChecks },
          { href: "/app/competency-records", label: "Competency records", icon: ClipboardCheck },
          ...(showPchAlrModules ? [{ href: "/app/practicums", label: "Practicums", icon: FileCheck }] : []),
          ...(showPchAlrModules ? [{ href: "/app/med-admin-roster", label: "Who can pass meds", icon: Pill }] : []),
          { href: "/app/credentials", label: "Credentials & clearances", icon: ShieldCheck },
          { href: "/app/background-checks", label: "Background checks", icon: ShieldQuestion },
          { href: "/me/courses", label: "My training", icon: BookOpen },
        ]
      },
      ...(showPchAlrModules ? [{
        title: "Residents & care",
        items: [
          { href: "/app/residents", label: "Residents", icon: BedDouble },
          { href: "/app/admissions", label: "Admissions & census", icon: ClipboardCheck },
          { href: "/app/change-of-condition", label: "Change follow-up", icon: Activity },
          { href: "/app/dietary-operations", label: "Dietary & food safety", icon: Utensils },
          { href: "/app/resident-services-calendar", label: "Resident calendar", icon: CalendarDays },
          { href: "/app/resident-finance", label: "Resident finance", icon: Landmark },
          { href: "/app/medication-integration", label: "Medication integration", icon: Pill },
          { href: "/app/qapi", label: "QAPI & quality", icon: BarChart3 },
          { href: "/app/state-forms", label: "State forms", icon: ClipboardList },
          { href: "/app/services", label: "Resident services", icon: CalendarDays },
          { href: "/app/resident-care-delivery", label: "Care delivery", icon: HeartPulse },
        ]
      }] : []),
      {
        title: "Safety & survey",
        items: [
          { href: "/app/incidents", label: "Incidents", icon: AlertTriangle },
          { href: "/app/complaints", label: "Complaints & grievances", icon: MessageSquareWarning },
          { href: "/app/confidential-incidents", label: "Confidential reports", icon: ShieldAlert },
          { href: "/app/work", label: "Work queue", icon: ClipboardList },
          { href: "/app/violations", label: "Violations & POCs", icon: Gavel },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
          ...(showPchAlrModules ? [{ href: "/app/inspection-readiness", label: "Inspection readiness", icon: Radar }] : []),
          ...(showPchAlrModules && showSurveyDay ? [{ href: "/app/survey-day", label: "Survey Day", icon: ShieldCheck }] : []),
          { href: "/app/compliance-binder", label: "Compliance binder", icon: Files },
          { href: "/app/evidence", label: "Documentation room", icon: FolderLock },
          { href: "/app/reports", label: "Reports", icon: BarChart3 },
          { href: "/app/audit", label: "Audit log", icon: ShieldAlert },
        ]
      },
      {
        title: "Advanced",
        items: [
          { href: "/app", label: "Compliance scorecard", icon: LayoutDashboard },
          { href: "/app/compliance-command-center", label: "Command Center", icon: ShieldCheck },
          { href: "/app/reports/comprehensive", label: "Comprehensive report", icon: Printer },
          ...(showPchAlrModules ? [{ href: "/app/pch-alr-operations", label: "PCH / ALF operations", icon: Crosshair }] : []),
          ...(showPchAlrModules ? [{ href: "/app/regulatory-crosswalk", label: "Regulatory crosswalk", icon: FileSearch }] : []),
          ...(showPchAlrModules ? [{ href: "/app/regulatory-copilot", label: "Regulatory copilot", icon: Sparkles }] : []),
          { href: "/app/policy-documents", label: "Policies & procedures", icon: FileSignature },
          { href: "/app/template-documents", label: "Template documents", icon: FileStack },
          { href: "/app/dhs-forms", label: "DHS forms library", icon: Landmark },
          { href: "/app/documents", label: "Documents", icon: Files },
          { href: "/app/help", label: "Help center", icon: HelpCircle },
        ]
      },
    ];
  } else if (role === "trainer") {
    return [
      {
        items: [
          { href: "/trainer", label: "Dashboard", icon: LayoutDashboard },
        ]
      },
      {
        title: "Classes & gaps",
        items: [
          { href: "/trainer/classes", label: "My classes", icon: GraduationCap },
          { href: "/trainer/gaps", label: "Training gaps", icon: ShieldAlert },
          { href: "/app/courses", label: "Training content", icon: GraduationCap },
          { href: "/app/course-assignments", label: "Assignments", icon: FileCheck },
          { href: "/app/training-plans", label: "Training plans", icon: ListChecks },
          { href: "/trainer/retraining", label: "Retraining monitor", icon: ShieldAlert },
          { href: "/app/pending-approvals", label: "Pending approvals", icon: ClipboardCheck },
          { href: "/me/courses", label: "My training", icon: BookOpen },
        ]
      },
      {
        title: "Competency",
        items: [
          { href: "/app/training-matrix", label: "Training matrix", icon: Grid },
          { href: "/app/competency-templates", label: "Competency templates", icon: ClipboardList },
          { href: "/app/competency-records", label: "Competency records", icon: ClipboardCheck },
          ...(showPchAlrModules ? [{ href: "/app/practicums", label: "Practicums", icon: FileCheck }] : []),
          ...(showPchAlrModules ? [{ href: "/app/med-admin-roster", label: "Who can pass meds", icon: Pill }] : []),
        ]
      },
      {
        title: "Directory",
        items: [
          { href: "/trainer/facilities", label: "Facilities", icon: Building2 },
          { href: "/trainer/employees", label: "Employees", icon: Users },
          ...(showPchAlrModules ? [{ href: "/app/inspections", label: "Inspections & equipment", icon: Flame }] : []),
          ...(showPchAlrModules ? [{ href: "/app/maintenance", label: "Maintenance", icon: Wrench }] : []),
        ]
      },
      {
        title: "Records",
        items: [
          { href: "/app/documents", label: "Documents", icon: Files },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
          { href: "/app/help", label: "Help center", icon: HelpCircle },
        ]
      },
    ];
  } else if (role === "employee") {
    return [
      {
        items: [
          { href: "/me", label: "Home", icon: LayoutDashboard },
        ]
      },
      {
        title: "My shift",
        items: [
          { href: "/me/shift", label: "My shift", icon: ClipboardList },
          { href: "/me/schedule", label: "My schedule", icon: CalendarDays },
          { href: "/me/services", label: "My services", icon: ClipboardCheck },
          { href: "/me/residents", label: "Resident chart", icon: HeartPulse },
          { href: "/me/change-of-condition", label: "Change follow-up", icon: Activity },
          ...(showPchAlrModules ? [{ href: "/me/dietary-operations", label: "Dietary & food safety", icon: Utensils }] : []),
          ...(showPchAlrModules ? [{ href: "/me/resident-services-calendar", label: "Resident calendar", icon: CalendarDays }] : []),
          { href: "/me/work", label: "My work", icon: ClipboardList },
        ]
      },
      {
        title: "My learning",
        items: [
          { href: "/me/courses", label: "Courses", icon: BookOpen },
          { href: "/me/trainings", label: "Training records", icon: GraduationCap },
          { href: "/me/attestations", label: "Policy signatures", icon: FileSignature },
        ]
      },
      {
        title: "My records",
        items: [
          { href: "/me/certificates", label: "Certificates", icon: FileCheck },
          { href: "/me/credentials", label: "Credentials", icon: ShieldCheck },
          { href: "/me/documents", label: "Documents", icon: Files },
        ]
      },
      {
        title: "Account",
        items: [
          { href: "/account/notifications", label: "Notification settings", icon: Bell },
          { href: "/me/help", label: "Help center", icon: HelpCircle },
        ]
      },
    ];
  }
  return [];
}

function isNavItemActive(item: NavItem, location: string): boolean {
  return location === item.href || (item.href !== "/admin" && item.href !== "/app" && item.href !== "/trainer" && item.href !== "/me" && location.startsWith(`${item.href}/`));
}

// Persisted per-user so each person's choice of which groups to keep collapsed sticks across
// visits, without needing a backend round-trip for what's purely a display preference.
function collapsedSectionsStorageKey(userId: string): string {
  return `cmtrain.sidebar.collapsedSections.${userId}`;
}

function loadCollapsedSections(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(collapsedSectionsStorageKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(userId: string, titles: Set<string>): void {
  try {
    window.localStorage.setItem(collapsedSectionsStorageKey(userId), JSON.stringify([...titles]));
  } catch {
    // localStorage unavailable (private browsing, quota) -- collapse state just won't persist
  }
}

/** Default-collapsed advanced/admin groups so daily work stays above the fold. */
const DEFAULT_COLLAPSED_SECTIONS = new Set(["Advanced", "Admin"]);

/**
 * The sidebar's inner content (logo, filter, nav sections, user footer). Shared by the
 * desktop `<aside>` and the mobile drawer. `onNavigate` lets the mobile drawer
 * close itself when a link is tapped.
 */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const handleLogout = useSignOut();
  const { toast } = useToast();
  const { facilityTypes, isLoading: facilityTypesLoading, isError: facilityTypesError } = useVisibleFacilityTypes();
  const organizationSettings = useGetOrganizationSettings(user?.organizationId ?? undefined);
  const navigation = useNavigationWorkspace();
  const moduleAccess = useProductModuleAccess();
  // Survey Day needs the survey_day_mode entitlement AND a release_flags row on top of the PCH/ALF
  // facility type. Without them the page renders "Survey Day isn't enabled for your organization
  // yet" instead of a workspace, so leading the onboarding list with it advertises a dead end.
  const surveyDayFeature = useOrgFeatureEnabled("survey_day_mode");
  const [filter, setFilter] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (!user) return new Set(DEFAULT_COLLAPSED_SECTIONS);
    const stored = loadCollapsedSections(user.id);
    // First visit: seed Advanced/Admin collapsed so managers land on daily work.
    return stored.size === 0 ? new Set(DEFAULT_COLLAPSED_SECTIONS) : stored;
  });
  const [collapsedSectionsUserId, setCollapsedSectionsUserId] = useState<string | null>(() => user?.id ?? null);

  useEffect(() => {
    if (!user) return;
    if (collapsedSectionsUserId !== user.id) {
      const stored = loadCollapsedSections(user.id);
      setCollapsedSections(stored.size === 0 ? new Set(DEFAULT_COLLAPSED_SECTIONS) : stored);
      setCollapsedSectionsUserId(user.id);
      return;
    }
    saveCollapsedSections(user.id, collapsedSections);
  }, [user, collapsedSections, collapsedSectionsUserId]);

  if (!user) return null;

  // Fail open (show) while the facility-type data is still loading or failed to load, rather
  // than hiding these items -- otherwise every PCH/ALR org (the common case) would see this
  // section flicker out on every fresh page load, and a query error would permanently hide it.
  const showPchAlrModules = facilityTypesLoading || facilityTypesError
    || hasAnyFacilityType(facilityTypes, PCH_ALR_ONLY_FACILITY_TYPES);
  // Same fail-open rule, for the same reason: the nav must not wait on this query, and a failed
  // read must not hide a page the organization has actually bought. Only a resolved "false" hides
  // it. Platform admins bypass the gate server-side and have no Survey Day nav entry either way.
  const showSurveyDay = surveyDayFeature.isLoading || surveyDayFeature.isError
    || surveyDayFeature.isEnabled;
  const hiddenSections = new Set(organizationSettings.data?.hidden_navigation_sections ?? []);
  const navSections = getNavSections(user.role, showPchAlrModules, showSurveyDay)
    .filter((section) => !section.title || !hiddenSections.has(section.title))
    .map((section) => ({
      ...section,
      // Guided links may include an action query (for example
      // /app/employees?action=add). canViewPage only accepts canonical page
      // entries, while canViewPath safely strips the query before checking the
      // role map.
      items: section.items.filter((item) => canViewPath(item.href, user.role, moduleAccess.enabledModules)),
    }))
    .filter((section) => section.items.length > 0);

  const toggleSection = (title: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  };

  const flattenedNavItems = navSections.flatMap((section) => section.items);
  const currentNavItem = flattenedNavItems.find((item) => isNavItemActive(item, location));
  const pinnedPages = new Set(navigation.favoritePaths);
  const isCurrentPagePinned = !!currentNavItem && pinnedPages.has(currentNavItem.href);
  const toggleCurrentPagePin = () => {
    if (!currentNavItem) return;
    const next = new Set(pinnedPages);
    if (next.has(currentNavItem.href)) next.delete(currentNavItem.href); else next.add(currentNavItem.href);
    navigation.setFavorites.mutate([...next], {
      onError: (error: Error) => {
        toast({
          title: "Couldn't update pinned pages",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const trimmedFilter = filter.trim().toLowerCase();
  const isFiltering = trimmedFilter.length > 0;

  const pinnedSection: NavSection | null = !isFiltering
    ? {
        title: "Pinned",
        items: flattenedNavItems.filter((item, index, all) =>
          pinnedPages.has(item.href) && all.findIndex((candidate) => candidate.href === item.href) === index,
        ),
      }
    : null;

  const recentSection: NavSection | null = !isFiltering
    ? {
        title: "Recent",
        items: navigation.recentPaths
          .filter((recent) => !pinnedPages.has(recent.path))
          .filter((recent) => canViewPath(recent.path, user.role, moduleAccess.enabledModules))
          .map((recent) => flattenedNavItems.find((item) => item.href === recent.path) ?? {
            href: recent.path,
            label: recent.label,
            icon: History,
          })
          .filter((item, index, all) => all.findIndex((candidate) => candidate.href === item.href) === index)
          .slice(0, 5),
      }
    : null;

  // While filtering, only show matching items so a long list narrows down to what was typed.
  // Otherwise show every item, and let each section's own collapsed/expanded state decide.
  const visibleSections = [
    ...(pinnedSection?.items.length ? [pinnedSection] : []),
    ...(recentSection?.items.length ? [recentSection] : []),
    ...navSections
      .map((section) => ({
        ...section,
        items: isFiltering
          ? section.items.filter((item) => item.label.toLowerCase().includes(trimmedFilter))
          : section.items,
      }))
      .filter((section) => section.items.length > 0),
  ];

  return (
    <>
      <div className="h-[68px] flex items-center gap-3 px-6 shrink-0">
        <div className="h-9 w-9 rounded-lg bg-white flex items-center justify-center">
          <LogoMark className="h-[30px] w-[30px]" />
        </div>
        <div className="flex flex-col">
          <BrandName className="font-bold text-[15px] text-sidebar-foreground leading-tight" />
          <span className="text-[11px] text-sidebar-foreground/50 font-medium">
            {moduleAccess.canAccessModule("carebase") ? "CareBase Platform" : "Train Learning Platform"}
          </span>
        </div>
      </div>

      <div className="px-3 pt-3 shrink-0 space-y-2">
        {currentNavItem && (
          <button
            type="button"
            onClick={toggleCurrentPagePin}
            className="w-full h-8 px-3 rounded-lg bg-sidebar-accent/30 hover:bg-sidebar-accent/50 text-[12px] font-medium text-sidebar-foreground/70 flex items-center gap-2 transition-colors"
            aria-pressed={isCurrentPagePinned}
          >
            <Star className={cn("h-3.5 w-3.5", isCurrentPagePinned && "fill-sidebar-primary text-sidebar-primary")} />
            {isCurrentPagePinned ? "Unpin current page" : "Pin current page"}
          </button>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/40 pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
            placeholder="Find a page..."
            aria-label="Filter navigation"
            className="w-full h-8 pl-8 pr-2 rounded-lg bg-sidebar-accent/40 border border-transparent text-[13px] text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-sidebar-primary/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]">
        {visibleSections.length === 0 && (
          <p className="px-3 py-6 text-[13px] text-sidebar-foreground/40 text-center">No pages match "{filter.trim()}"</p>
        )}
        {visibleSections.map((section, si) => {
          const containsActiveItem = section.items.some((item) => isNavItemActive(item, location));
          const isOpen = isFiltering || !section.title || containsActiveItem || !collapsedSections.has(section.title);
          const sectionKey = section.title ?? section.items[0]?.href ?? "dashboard";
          return (
            <div key={sectionKey} className={cn(si > 0 && "mt-3")}>
              {section.title && (
                <button
                  type="button"
                  onClick={() => toggleSection(section.title!)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 mb-1 rounded-md hover:bg-sidebar-accent/40 transition-colors"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                    {section.title}
                  </span>
                  <ChevronDown className={cn(
                    "h-3.5 w-3.5 text-sidebar-foreground/30 transition-transform duration-150",
                    !isOpen && "-rotate-90"
                  )} />
                </button>
              )}
              {isOpen && (
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = isNavItemActive(item, location);
                    const isExactActive = location === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => { setFilter(""); onNavigate?.(); }}
                        className={cn(
                          "group flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 text-[13px] font-medium relative",
                          (isActive || isExactActive)
                            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        )}
                      >
                        <Icon className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-colors",
                          (isActive || isExactActive) ? "text-sidebar-primary" : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60"
                        )} />
                        <span className="flex-1">{item.label}</span>
                        {(isActive || isExactActive) && (
                          <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/30" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-4 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg text-left hover:bg-sidebar-accent/60 transition-colors"
              aria-label="Account menu"
            >
              <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-bold text-sidebar-primary shrink-0">
                {user.firstName?.[0]}{user.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-sidebar-foreground truncate">{user.firstName} {user.lastName}</p>
                <p className="text-[11px] text-sidebar-foreground/40 capitalize truncate">{user.role.replace(/_/g, " ")}</p>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-sidebar-foreground/40 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start" side="top">
            <DropdownMenuLabel className="flex flex-col gap-0">
              <span className="text-sm font-medium leading-tight">{user.firstName} {user.lastName}</span>
              <span className="text-xs font-normal text-muted-foreground leading-tight">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account/security" className="cursor-pointer" onClick={onNavigate}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                <span>Account security</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/notifications" className="cursor-pointer" onClick={onNavigate}>
                <Bell className="mr-2 h-4 w-4" />
                <span>Notification settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

/** Desktop sidebar -- a fixed rail, hidden below md where the mobile drawer takes over. */
export function Sidebar() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <aside className="hidden md:flex h-screen w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <SidebarNav />
    </aside>
  );
}

/** Mobile sidebar -- the same nav in an off-canvas drawer, opened from the header. */
export function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [location] = useLocation();

  // Close the drawer on any route change (covers nav taps and programmatic navigation).
  React.useEffect(() => {
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[280px] max-w-[85vw] p-0 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col gap-0"
      >
        <SidebarNav onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
