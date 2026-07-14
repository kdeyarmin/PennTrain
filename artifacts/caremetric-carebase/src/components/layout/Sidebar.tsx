import React, { useEffect, useState } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { canViewPage } from "@/lib/appDomains";
import { useVisibleFacilityTypes } from "@/hooks/useVisibleFacilityTypes";
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
<<<<<<< HEAD
  HeartPulse,
=======
>>>>>>> origin/main
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { title?: string; items: NavItem[] };

function getNavSections(role: AuthUser["role"], showPchAlrModules: boolean): NavSection[] {
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
          { href: "/app/qapi", label: "QAPI & Quality", icon: BarChart3 },
          { href: "/admin/audit", label: "Audit Log", icon: ShieldAlert },
          { href: "/admin/notifications", label: "Notification Delivery", icon: Send },
          { href: "/admin/system-jobs", label: "System Jobs", icon: Activity },
          { href: "/admin/enterprise", label: "Enterprise Foundation", icon: Network },
          { href: "/admin/qualified-workforce", label: "Qualified Workforce", icon: UserRoundCheck },
          { href: "/admin/governed-learning", label: "Governed Content", icon: BookCheck },
          { href: "/admin/closed-loop-compliance", label: "Closed-Loop Compliance", icon: Gavel },
          { href: "/admin/exclusion-screening", label: "Exclusion Screening", icon: ShieldAlert },
          { href: "/admin/security", label: "Security & Governance", icon: Eye },
          { href: "/admin/support-tickets", label: "Support Tickets", icon: LifeBuoy },
        ]
      },
      {
        title: "Platform",
        items: [
          { href: "/admin/settings", label: "Settings", icon: Sliders },
          { href: "/admin/roadmap", label: "Improvement Roadmap", icon: Rocket },
        ]
      }
    ];
  } else if (role === "org_admin" || role === "facility_manager") {
    return [
      {
        items: [
          { href: "/app", label: "Dashboard", icon: LayoutDashboard },
        ]
      },
      {
        title: "Guided Workflows",
        items: [
          { href: "/app/employees?action=add", label: "Onboard Employee", icon: Users },
          ...(showPchAlrModules
            ? [{ href: "/app/inspection-readiness", label: "Prepare for Inspection", icon: Radar }]
            : []),
          { href: "/app/alerts", label: "Resolve Compliance Risks", icon: ShieldAlert },
        ],
      },
      {
        title: "Directory",
        items: [
          { href: "/app/facilities", label: "Facilities", icon: Building2 },
          { href: "/app/employees", label: "Employees", icon: Users },
          { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
          { href: "/app/workforce-operations", label: "Workforce Operations", icon: UserRoundCheck },
          ...(showPchAlrModules ? [{ href: "/app/inspections", label: "Inspections & Equipment", icon: Flame }] : []),
          ...(showPchAlrModules ? [{ href: "/app/emergency", label: "Emergency Operations", icon: Siren }] : []),
          ...(showPchAlrModules ? [{ href: "/app/maintenance", label: "Maintenance & Work Orders", icon: Wrench }] : []),
        ]
      },
      {
        title: "Staff Training & Requirements",
        items: [
          { href: "/app/training-matrix", label: "Training Matrix", icon: Grid },
          { href: "/app/courses", label: "Training Content", icon: GraduationCap },
          { href: "/app/course-assignments", label: "Training Assignments", icon: FileCheck },
          { href: "/trainer/classes", label: "In-Service Classes", icon: GraduationCap },
          { href: "/app/training-plans", label: "Training Plans", icon: ListChecks },
          { href: "/app/governed-learning", label: "Governed Content", icon: BookCheck },
          { href: "/me/courses", label: "My Training", icon: BookOpen },
        ]
      },
      {
        title: "Competency & Qualifications",
        items: [
          { href: "/app/competency-templates", label: "Competency Templates", icon: ClipboardList },
          { href: "/app/competency-records", label: "Competency Records", icon: ClipboardCheck },
          ...(showPchAlrModules ? [{ href: "/app/practicums", label: "Practicums", icon: FileCheck }] : []),
          ...(showPchAlrModules ? [{ href: "/app/administrator-qualification", label: "Administrator Qualification", icon: GraduationCap }] : []),
        ]
      },
      {
        title: "Credentialing & Screening",
        items: [
          ...(showPchAlrModules ? [{ href: "/app/med-admin-roster", label: "Who Can Pass Meds", icon: Pill }] : []),
          { href: "/app/credentials", label: "Credentials & Clearances", icon: ShieldCheck },
          { href: "/app/background-checks", label: "Background Checks", icon: ShieldQuestion },
          { href: "/app/exclusion-screening", label: "Exclusion Screening", icon: ShieldAlert },
        ]
      },
      ...(showPchAlrModules ? [{
        title: "Residents",
        items: [
          { href: "/app/residents", label: "Residents", icon: BedDouble },
          { href: "/app/admissions", label: "Admissions & Census", icon: ClipboardCheck },
          { href: "/app/change-of-condition", label: "Change Follow-Up", icon: Activity },
          { href: "/app/dietary-operations", label: "Dietary & Food Safety", icon: Utensils },
          { href: "/app/resident-services-calendar", label: "Resident Calendar", icon: CalendarDays },
          { href: "/app/resident-finance", label: "Resident Finance", icon: Landmark },
          { href: "/app/qapi", label: "QAPI & Quality", icon: BarChart3 },
          { href: "/app/state-forms", label: "State Forms", icon: ClipboardList },
          { href: "/app/services", label: "Resident Services", icon: CalendarDays },
          { href: "/app/resident-care-delivery", label: "Care Delivery", icon: HeartPulse },
        ]
      }] : []),
      {
        title: "Incidents & Alerts",
        items: [
          { href: "/app/incidents", label: "Incidents", icon: AlertTriangle },
          { href: "/app/complaints", label: "Complaints & Grievances", icon: MessageSquareWarning },
          { href: "/app/confidential-incidents", label: "Confidential Reports", icon: ShieldAlert },
          { href: "/app/work", label: "Operational Work", icon: ClipboardList },
          { href: "/app/violations", label: "Violations & POCs", icon: Gavel },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
          { href: "/app/pending-approvals", label: "Pending Approvals", icon: ClipboardCheck },
        ]
      },
      {
        title: "Reporting & Documents",
        items: [
          { href: "/app/reports", label: "Reports", icon: BarChart3 },
          { href: "/app/closed-loop-compliance", label: "Closed-Loop Compliance", icon: Gavel },
          ...(showPchAlrModules ? [{ href: "/app/inspection-readiness", label: "Inspection Readiness", icon: Radar }] : []),
          ...(showPchAlrModules ? [{ href: "/app/pch-alr-operations", label: "PCH / ALF Operations", icon: Crosshair }] : []),
          ...(showPchAlrModules ? [{ href: "/app/regulatory-crosswalk", label: "Regulatory Crosswalk", icon: FileSearch }] : []),
          { href: "/app/compliance-binder", label: "Compliance Binder", icon: Files },
          { href: "/app/evidence", label: "Evidence Room", icon: FolderLock },
          { href: "/app/policy-documents", label: "Policies & Procedures", icon: FileSignature },
          { href: "/app/template-documents", label: "Template Documents", icon: FileStack },
          { href: "/app/dhs-forms", label: "DHS Forms Library", icon: Landmark },
          { href: "/app/documents", label: "Documents", icon: Files },
        ]
      },
      {
        title: "Settings",
        items: [
          { href: "/app/users", label: "Users", icon: Users },
          { href: "/app/training-types", label: "Training Types", icon: ListChecks },
          { href: "/app/settings", label: "Settings", icon: Settings },
          ...(role === "org_admin"
            ? [{ href: "/app/enterprise", label: "Enterprise Foundation", icon: Network }]
            : []),
          // Phase 1 audit evidence carries facility scope, so managers see only their assigned
          // facilities while org administrators retain organization-wide visibility.
          ...(["org_admin", "facility_manager"].includes(role ?? "")
            ? [{ href: "/app/audit", label: "Audit Log", icon: ShieldAlert }]
            : []),
        ]
      },
      {
        title: "Help",
        items: [
          { href: "/app/help", label: "Help Center", icon: HelpCircle },
        ]
      }
    ];
  } else if (role === "auditor") {
    return [
      {
        items: [
          { href: "/app", label: "Dashboard", icon: LayoutDashboard },
        ]
      },
      {
        title: "Directory",
        items: [
          { href: "/app/facilities", label: "Facilities", icon: Building2 },
          { href: "/app/employees", label: "Employees", icon: Users },
          ...(showPchAlrModules ? [{ href: "/app/inspections", label: "Inspections & Equipment", icon: Flame }] : []),
          ...(showPchAlrModules ? [{ href: "/app/emergency", label: "Emergency Operations", icon: Siren }] : []),
          ...(showPchAlrModules ? [{ href: "/app/maintenance", label: "Maintenance & Work Orders", icon: Wrench }] : []),
        ]
      },
      {
        title: "Training & Competency",
        items: [
          { href: "/app/training-matrix", label: "Training Matrix", icon: Grid },
          { href: "/app/course-assignments", label: "Training Assignments", icon: FileCheck },
          { href: "/app/training-plans", label: "Training Plans", icon: ListChecks },
          { href: "/app/competency-records", label: "Competency Records", icon: ClipboardCheck },
          ...(showPchAlrModules ? [{ href: "/app/practicums", label: "Practicums", icon: FileCheck }] : []),
          { href: "/me/courses", label: "My Training", icon: BookOpen },
        ]
      },
      {
        title: "Credentialing & Screening",
        items: [
          ...(showPchAlrModules ? [{ href: "/app/med-admin-roster", label: "Who Can Pass Meds", icon: Pill }] : []),
          { href: "/app/credentials", label: "Credentials & Clearances", icon: ShieldCheck },
          { href: "/app/background-checks", label: "Background Checks", icon: ShieldQuestion },
          { href: "/app/exclusion-screening", label: "Exclusion Screening", icon: ShieldAlert },
        ]
      },
      ...(showPchAlrModules ? [{
        title: "Residents",
        items: [
          { href: "/app/residents", label: "Residents", icon: BedDouble },
          { href: "/app/admissions", label: "Admissions & Census", icon: ClipboardCheck },
          { href: "/app/change-of-condition", label: "Change Follow-Up", icon: Activity },
          { href: "/app/dietary-operations", label: "Dietary & Food Safety", icon: Utensils },
          { href: "/app/resident-services-calendar", label: "Resident Calendar", icon: CalendarDays },
          { href: "/app/resident-finance", label: "Resident Finance", icon: Landmark },
          { href: "/app/qapi", label: "QAPI & Quality", icon: BarChart3 },
          { href: "/app/state-forms", label: "State Forms", icon: ClipboardList },
          { href: "/app/services", label: "Resident Services", icon: CalendarDays },
          { href: "/app/resident-care-delivery", label: "Care Delivery", icon: HeartPulse },
        ]
      }] : []),
      {
        title: "Incidents & Alerts",
        items: [
          { href: "/app/incidents", label: "Incidents", icon: AlertTriangle },
          { href: "/app/complaints", label: "Complaints & Grievances", icon: MessageSquareWarning },
          { href: "/app/confidential-incidents", label: "Confidential Reports", icon: ShieldAlert },
          { href: "/app/work", label: "Operational Work", icon: ClipboardList },
          { href: "/app/violations", label: "Violations & POCs", icon: Gavel },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
        ]
      },
      {
        title: "Reporting & Documents",
        items: [
          { href: "/app/reports", label: "Reports", icon: BarChart3 },
          ...(showPchAlrModules ? [{ href: "/app/inspection-readiness", label: "Inspection Readiness", icon: Radar }] : []),
          ...(showPchAlrModules ? [{ href: "/app/pch-alr-operations", label: "PCH / ALF Operations", icon: Crosshair }] : []),
          ...(showPchAlrModules ? [{ href: "/app/regulatory-crosswalk", label: "Regulatory Crosswalk", icon: FileSearch }] : []),
          { href: "/app/compliance-binder", label: "Compliance Binder", icon: Files },
          { href: "/app/evidence", label: "Evidence Room", icon: FolderLock },
          { href: "/app/policy-documents", label: "Policies & Procedures", icon: FileSignature },
          { href: "/app/template-documents", label: "Template Documents", icon: FileStack },
          { href: "/app/dhs-forms", label: "DHS Forms Library", icon: Landmark },
          { href: "/app/documents", label: "Documents", icon: Files },
          { href: "/app/audit", label: "Audit Log", icon: ShieldAlert },
        ]
      },
      {
        title: "Help",
        items: [
          { href: "/app/help", label: "Help Center", icon: HelpCircle },
        ]
      }
    ];
  } else if (role === "trainer") {
    return [
      {
        items: [
          { href: "/trainer", label: "Dashboard", icon: LayoutDashboard },
        ]
      },
      {
        title: "Training",
        items: [
          { href: "/trainer/classes", label: "My Classes", icon: GraduationCap },
          { href: "/app/courses", label: "Training Content", icon: GraduationCap },
          { href: "/app/course-assignments", label: "Training Assignments", icon: FileCheck },
          { href: "/app/training-plans", label: "Training Plans", icon: ListChecks },
          { href: "/trainer/retraining", label: "Retraining Monitor", icon: ShieldAlert },
          { href: "/app/pending-approvals", label: "Pending Approvals", icon: ClipboardCheck },
          { href: "/me/courses", label: "My Training", icon: BookOpen },
        ]
      },
      {
        title: "Competency",
        items: [
          { href: "/app/training-matrix", label: "Training Matrix", icon: Grid },
          { href: "/app/competency-templates", label: "Competency Templates", icon: ClipboardList },
          { href: "/app/competency-records", label: "Competency Records", icon: ClipboardCheck },
          ...(showPchAlrModules ? [{ href: "/app/practicums", label: "Practicums", icon: FileCheck }] : []),
          ...(showPchAlrModules ? [{ href: "/app/med-admin-roster", label: "Who Can Pass Meds", icon: Pill }] : []),
        ]
      },
      {
        title: "Directory",
        items: [
          { href: "/trainer/facilities", label: "Facilities", icon: Building2 },
          { href: "/trainer/employees", label: "Employees", icon: Users },
          // Mounted at /app/* (not /trainer/*) since inspections has no separate trainer-scoped
          // page -- ProtectedRoute gates by role membership, not URL prefix, and
          // INSPECTION_ROLES already includes trainer.
          ...(showPchAlrModules ? [{ href: "/app/inspections", label: "Inspections & Equipment", icon: Flame }] : []),
          ...(showPchAlrModules ? [{ href: "/app/maintenance", label: "Maintenance & Work Orders", icon: Wrench }] : []),
        ]
      },
      {
        title: "Records",
        items: [
          { href: "/app/documents", label: "Documents", icon: Files },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
        ]
      },
      {
        title: "Help",
        items: [
          { href: "/app/help", label: "Help Center", icon: HelpCircle },
        ]
      }
    ];
  } else if (role === "employee") {
    return [
      {
        items: [
          { href: "/me", label: "My Training", icon: LayoutDashboard },
        ]
      },
      {
        title: "Schedule & Courses",
        items: [
          { href: "/me/schedule", label: "My Schedule", icon: CalendarDays },
          { href: "/me/services", label: "My Services", icon: ClipboardCheck },
          { href: "/me/change-of-condition", label: "Change Follow-Up", icon: Activity },
          ...(showPchAlrModules ? [{ href: "/me/dietary-operations", label: "Dietary & Food Safety", icon: Utensils }] : []),
          ...(showPchAlrModules ? [{ href: "/me/resident-services-calendar", label: "Resident Calendar", icon: CalendarDays }] : []),
          { href: "/me/work", label: "My Work", icon: ClipboardList },
          { href: "/me/courses", label: "My Training", icon: BookOpen },
        ]
      },
      {
        title: "My Records",
        items: [
          { href: "/me/trainings", label: "Training Records", icon: GraduationCap },
          { href: "/me/certificates", label: "My Certificates", icon: FileCheck },
          { href: "/me/documents", label: "My Documents", icon: Files },
          { href: "/me/credentials", label: "My Credentials", icon: ShieldCheck },
          { href: "/me/attestations", label: "My Attestations", icon: FileSignature },
        ]
      },
      {
        title: "Help",
        items: [
          { href: "/me/help", label: "Help Center", icon: HelpCircle },
        ]
      },
      {
        title: "Settings",
        items: [
          { href: "/account/notifications", label: "Notification Settings", icon: Bell },
        ]
      }
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

function pinnedPagesStorageKey(userId: string): string {
  return `cmtrain.sidebar.pinnedPages.${userId}`;
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

function loadPinnedPages(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(pinnedPagesStorageKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function savePinnedPages(userId: string, hrefs: Set<string>): void {
  try {
    window.localStorage.setItem(pinnedPagesStorageKey(userId), JSON.stringify([...hrefs]));
  } catch {
    // localStorage unavailable -- pinned pages just won't persist.
  }
}

/**
 * The sidebar's inner content (logo, filter, nav sections, user footer). Shared by the
 * desktop `<aside>` and the mobile drawer. `onNavigate` lets the mobile drawer
 * close itself when a link is tapped.
 */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const handleLogout = useSignOut();
  const { facilityTypes, isLoading: facilityTypesLoading, isError: facilityTypesError } = useVisibleFacilityTypes();
  const [filter, setFilter] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => (user ? loadCollapsedSections(user.id) : new Set()));
  const [collapsedSectionsUserId, setCollapsedSectionsUserId] = useState<string | null>(() => user?.id ?? null);
  const [pinnedPages, setPinnedPages] = useState<Set<string>>(() => (user ? loadPinnedPages(user.id) : new Set()));

  useEffect(() => {
    if (!user) return;
    if (collapsedSectionsUserId !== user.id) {
      setCollapsedSections(loadCollapsedSections(user.id));
      setCollapsedSectionsUserId(user.id);
      return;
    }
    saveCollapsedSections(user.id, collapsedSections);
  }, [user, collapsedSections, collapsedSectionsUserId]);

  useEffect(() => {
    if (user) savePinnedPages(user.id, pinnedPages);
  }, [user, pinnedPages]);

  if (!user) return null;

  // Fail open (show) while the facility-type data is still loading or failed to load, rather
  // than hiding these items -- otherwise every PCH/ALR org (the common case) would see this
  // section flicker out on every fresh page load, and a query error would permanently hide it.
  const showPchAlrModules = facilityTypesLoading || facilityTypesError
    || hasAnyFacilityType(facilityTypes, PCH_ALR_ONLY_FACILITY_TYPES);
  const navSections = getNavSections(user.role, showPchAlrModules)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canViewPage(item.href, user.role)),
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
  const isCurrentPagePinned = !!currentNavItem && pinnedPages.has(currentNavItem.href);
  const toggleCurrentPagePin = () => {
    if (!currentNavItem) return;
    setPinnedPages((prev) => {
      const next = new Set(prev);
      if (next.has(currentNavItem.href)) next.delete(currentNavItem.href); else next.add(currentNavItem.href);
      return next;
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

  // While filtering, only show matching items so a long list narrows down to what was typed.
  // Otherwise show every item, and let each section's own collapsed/expanded state decide.
  const visibleSections = [
    ...(pinnedSection?.items.length ? [pinnedSection] : []),
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
          <span className="text-[11px] text-sidebar-foreground/50 font-medium">Compliance Platform</span>
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
