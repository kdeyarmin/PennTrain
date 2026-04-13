import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
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
  GraduationCap
} from "lucide-react";

export function Sidebar() {
  const { user } = useAuth();
  const [location] = useLocation();

  if (!user) return null;

  const role = user.role;

  let navItems = [];

  if (role === "platform_admin") {
    navItems = [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/organizations", label: "Organizations", icon: Building2 },
      { href: "/admin/facilities", label: "Facilities", icon: Grid },
      { href: "/admin/employees", label: "Employees", icon: Users },
      { href: "/admin/alerts", label: "Alerts", icon: Bell },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/audit", label: "Audit Log", icon: ShieldAlert },
    ];
  } else if (role === "org_admin" || role === "facility_manager") {
    navItems = [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/facilities", label: "Facilities", icon: Building2 },
      { href: "/app/employees", label: "Employees", icon: Users },
      { href: "/app/training-matrix", label: "Training Matrix", icon: Grid },
      { href: "/app/practicums", label: "Practicums", icon: FileCheck },
      { href: "/app/alerts", label: "Alerts", icon: Bell },
      { href: "/app/reports", label: "Reports", icon: BarChart3 },
      { href: "/app/documents", label: "Documents", icon: Files },
      { href: "/app/users", label: "Users", icon: Users },
      { href: "/app/settings", label: "Settings", icon: Settings },
      { href: "/app/audit", label: "Audit Log", icon: ShieldAlert },
    ];
  } else if (role === "trainer") {
    navItems = [
      { href: "/trainer", label: "Dashboard", icon: LayoutDashboard },
      { href: "/trainer/classes", label: "My Classes", icon: GraduationCap },
      { href: "/trainer/facilities", label: "Facilities", icon: Building2 },
      { href: "/trainer/employees", label: "Employees", icon: Users },
    ];
  } else if (role === "employee") {
    navItems = [
      { href: "/me", label: "My Training", icon: LayoutDashboard },
      { href: "/me/trainings", label: "Training Records", icon: GraduationCap },
      { href: "/me/documents", label: "My Documents", icon: Files },
    ];
  }

  return (
    <div className="w-64 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col h-full shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <h1 className="font-bold text-lg text-sidebar-primary-foreground">PA MedTrack</h1>
      </div>
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href || location.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
