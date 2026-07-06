import React from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
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
  Pill,
  FileSignature,
  ShieldQuestion,
  Radar,
  Gavel,
  BookOpen,
  BedDouble,
  FileStack,
  Sparkles,
  Send,
  Sliders,
  Eye
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { title?: string; items: NavItem[] };

function getNavSections(role: AuthUser["role"]): NavSection[] {
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
          { href: "/admin/courses/new-ai", label: "New AI Course", icon: Sparkles },
          { href: "/admin/ai-generations", label: "AI Generation Log", icon: BarChart3 },
        ]
      },
      {
        title: "Oversight",
        items: [
          { href: "/admin/alerts", label: "Alerts", icon: Bell },
          { href: "/admin/audit", label: "Audit Log", icon: ShieldAlert },
          { href: "/admin/notifications", label: "Notification Delivery", icon: Send },
          { href: "/admin/security", label: "Security & Governance", icon: Eye },
        ]
      },
      {
        title: "Platform",
        items: [
          { href: "/admin/settings", label: "Settings", icon: Sliders },
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
        title: "Operations",
        items: [
          { href: "/app/facilities", label: "Facilities", icon: Building2 },
          { href: "/app/employees", label: "Employees", icon: Users },
          { href: "/app/training-matrix", label: "Training Matrix", icon: Grid },
          { href: "/app/courses", label: "Courses", icon: GraduationCap },
          { href: "/app/course-assignments", label: "Course Assignments", icon: FileCheck },
          { href: "/trainer/classes", label: "In-Service Classes", icon: GraduationCap },
          { href: "/app/training-plans", label: "Training Plans", icon: ListChecks },
          { href: "/app/competency-templates", label: "Competency Templates", icon: ClipboardList },
          { href: "/app/competency-records", label: "Competency Records", icon: ClipboardCheck },
          { href: "/app/practicums", label: "Practicums", icon: FileCheck },
          { href: "/app/med-admin-roster", label: "Who Can Pass Meds", icon: Pill },
          { href: "/app/credentials", label: "Credentials & Clearances", icon: ShieldCheck },
          { href: "/app/background-checks", label: "Background Checks", icon: ShieldQuestion },
          { href: "/app/exclusion-screening", label: "Exclusion Screening", icon: ShieldAlert },
          { href: "/app/administrator-qualification", label: "Administrator Qualification", icon: GraduationCap },
          { href: "/app/inspections", label: "Inspections & Equipment", icon: Flame },
        ]
      },
      {
        title: "Compliance",
        items: [
          { href: "/app/incidents", label: "Incidents & Complaints", icon: AlertTriangle },
          { href: "/app/violations", label: "Violations & POCs", icon: Gavel },
          { href: "/app/residents", label: "Residents", icon: BedDouble },
          { href: "/app/resident-compliance", label: "Resident Compliance", icon: ClipboardList },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
          { href: "/app/pending-approvals", label: "Pending Approvals", icon: ClipboardCheck },
          { href: "/app/reports", label: "Reports", icon: BarChart3 },
          { href: "/app/inspection-readiness", label: "Inspection Readiness", icon: Radar },
          { href: "/app/compliance-binder", label: "Compliance Binder", icon: Files },
          { href: "/app/policy-documents", label: "Policies & Procedures", icon: FileSignature },
          { href: "/app/template-documents", label: "Template Documents", icon: FileStack },
          { href: "/app/documents", label: "Documents", icon: Files },
        ]
      },
      {
        title: "Settings",
        items: [
          { href: "/app/users", label: "Users", icon: Users },
          { href: "/app/training-types", label: "Training Types", icon: ListChecks },
          { href: "/app/settings", label: "Settings", icon: Settings },
          // Audit Log is org_admin/auditor-only (see AUDIT_LOG_ROLES in App.tsx) -- audit_logs has
          // no facility_id column, so it can't be scoped to a facility_manager's own facility the
          // way every other facility_manager grant in this schema is.
          ...(role === "org_admin" ? [{ href: "/app/audit", label: "Audit Log", icon: ShieldAlert }] : []),
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
          { href: "/app/training-matrix", label: "Training Matrix", icon: Grid },
          { href: "/app/course-assignments", label: "Course Assignments", icon: FileCheck },
          { href: "/app/training-plans", label: "Training Plans", icon: ListChecks },
          { href: "/app/competency-records", label: "Competency Records", icon: ClipboardCheck },
          { href: "/app/practicums", label: "Practicums", icon: FileCheck },
          { href: "/app/med-admin-roster", label: "Who Can Pass Meds", icon: Pill },
          { href: "/app/credentials", label: "Credentials & Clearances", icon: ShieldCheck },
          { href: "/app/background-checks", label: "Background Checks", icon: ShieldQuestion },
          { href: "/app/exclusion-screening", label: "Exclusion Screening", icon: ShieldAlert },
          { href: "/app/inspections", label: "Inspections & Equipment", icon: Flame },
        ]
      },
      {
        title: "Compliance",
        items: [
          { href: "/app/incidents", label: "Incidents & Complaints", icon: AlertTriangle },
          { href: "/app/violations", label: "Violations & POCs", icon: Gavel },
          { href: "/app/residents", label: "Residents", icon: BedDouble },
          { href: "/app/resident-compliance", label: "Resident Compliance", icon: ClipboardList },
          { href: "/app/alerts", label: "Alerts", icon: Bell },
          { href: "/app/reports", label: "Reports", icon: BarChart3 },
          { href: "/app/inspection-readiness", label: "Inspection Readiness", icon: Radar },
          { href: "/app/compliance-binder", label: "Compliance Binder", icon: Files },
          { href: "/app/policy-documents", label: "Policies & Procedures", icon: FileSignature },
          { href: "/app/template-documents", label: "Template Documents", icon: FileStack },
          { href: "/app/documents", label: "Documents", icon: Files },
          { href: "/app/audit", label: "Audit Log", icon: ShieldAlert },
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
          { href: "/trainer/retraining", label: "Retraining Monitor", icon: ShieldAlert },
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
          { href: "/app/inspections", label: "Inspections & Equipment", icon: Flame },
        ]
      }
    ];
  } else if (role === "employee") {
    return [
      {
        items: [
          { href: "/me", label: "My Training", icon: LayoutDashboard },
          { href: "/me/courses", label: "My Courses", icon: BookOpen },
          { href: "/me/trainings", label: "Training Records", icon: GraduationCap },
          { href: "/me/certificates", label: "My Certificates", icon: FileCheck },
          { href: "/me/documents", label: "My Documents", icon: Files },
          { href: "/me/credentials", label: "My Credentials", icon: ShieldCheck },
          { href: "/me/attestations", label: "My Attestations", icon: FileSignature },
        ]
      }
    ];
  }
  return [];
}

/**
 * The sidebar's inner content (logo, nav sections, user footer). Shared by the
 * desktop `<aside>` and the mobile drawer. `onNavigate` lets the mobile drawer
 * close itself when a link is tapped.
 */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const handleLogout = useSignOut();

  if (!user) return null;

  const navSections = getNavSections(user.role);

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

      <div className="flex-1 overflow-y-auto py-3 px-3">
        {navSections.map((section, si) => (
          <div key={si} className={cn(si > 0 && "mt-6")}>
            {section.title && (
              <div className="px-3 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                  {section.title}
                </span>
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location === item.href || (item.href !== "/admin" && item.href !== "/app" && item.href !== "/trainer" && item.href !== "/me" && location.startsWith(`${item.href}/`));
                const isExactActive = location === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
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
          </div>
        ))}
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
    <aside className="hidden md:flex w-[260px] bg-sidebar text-sidebar-foreground flex-col h-full shrink-0 border-r border-sidebar-border">
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
