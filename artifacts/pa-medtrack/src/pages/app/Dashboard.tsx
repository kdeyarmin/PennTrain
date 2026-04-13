import { useGetDashboardSummary, useListAlerts, useListFacilities } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, AlertTriangle, CheckCircle, Clock, XCircle, AlertCircle, ChevronRight, TrendingUp, Shield, Activity } from "lucide-react";
import { Link } from "wouter";

export default function OrgDashboard() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({});
  const { data: alerts } = useListAlerts({ status: "open" });
  const { data: facilities } = useListFacilities({});

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];
  const compliancePct = summary?.compliancePercentage ?? 100;

  const complianceColor = compliancePct >= 90 ? "text-emerald-600" : compliancePct >= 75 ? "text-amber-600" : "text-red-600";
  const complianceBg = compliancePct >= 90 ? "bg-emerald-500" : compliancePct >= 75 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1>Compliance Dashboard</h1>
        <p>Welcome back, {user?.firstName}. Here's your compliance overview.</p>
      </div>

      {criticalAlerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-5 flex items-start gap-4">
          <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-900">
              {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? "s" : ""} Require Attention
            </p>
            <p className="text-sm text-red-700/80 mt-0.5">{criticalAlerts[0]?.title}</p>
          </div>
          <Link href="/app/alerts">
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white shadow-sm">
              View Alerts
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="stat-label">Compliant</p>
              <p className="stat-value text-emerald-600">{summaryLoading ? "..." : summary?.compliantCount ?? 0}</p>
            </div>
            <div className="stat-icon bg-emerald-50">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>On track</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="stat-label">Due Soon</p>
              <p className="stat-value text-amber-600">{summaryLoading ? "..." : summary?.dueSoon30Count ?? 0}</p>
            </div>
            <div className="stat-icon bg-amber-50">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 font-medium">
            <Activity className="h-3.5 w-3.5" />
            <span>Within 30 days</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="stat-label">Expired</p>
              <p className="stat-value text-red-600">{summaryLoading ? "..." : summary?.expiredCount ?? 0}</p>
            </div>
            <div className="stat-icon bg-red-50">
              <XCircle className="h-5 w-5 text-red-600" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Needs renewal</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="stat-label">Missing Docs</p>
              <p className="stat-value text-slate-600">{summaryLoading ? "..." : summary?.missingDocumentCount ?? 0}</p>
            </div>
            <div className="stat-icon bg-slate-100">
              <AlertTriangle className="h-5 w-5 text-slate-500" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <Shield className="h-3.5 w-3.5" />
            <span>Action required</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 premium-card">
          <div className="p-6 border-b border-border/60">
            <h3 className="section-title">Overall Compliance Score</h3>
          </div>
          <div className="p-6">
            <div className="flex items-end gap-4 mb-5">
              <span className={`text-5xl font-bold tracking-tighter ${complianceColor}`}>{compliancePct}%</span>
              <span className="text-sm text-muted-foreground mb-1.5">of training records compliant</span>
            </div>
            <div className="relative h-3 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${complianceBg}`}
                style={{ width: `${compliancePct}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="rounded-lg bg-muted/50 p-3.5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium">Active Staff</span>
                </div>
                <p className="text-xl font-bold">{summary?.totalEmployees ?? 0}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3.5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-medium">Open Alerts</span>
                </div>
                <p className="text-xl font-bold">{summary?.openAlertsCount ?? 0}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3.5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs font-medium">Med Admin</span>
                </div>
                <p className="text-xl font-bold">{summary?.totalMedAdminStaff ?? 0}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 premium-card flex flex-col">
          <div className="p-6 border-b border-border/60 flex items-center justify-between">
            <h3 className="section-title">Recent Alerts</h3>
            <Link href="/app/alerts">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
                View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <div className="flex-1 p-4">
            <div className="space-y-2">
              {alerts?.slice(0, 5).map(alert => (
                <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                    alert.severity === "critical" ? "bg-red-500" : alert.severity === "warning" ? "bg-amber-500" : "bg-blue-500"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium leading-snug">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{alert.message}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${
                    alert.severity === "critical" ? "border-red-200 text-red-600 bg-red-50" :
                    alert.severity === "warning" ? "border-amber-200 text-amber-600 bg-amber-50" :
                    "border-blue-200 text-blue-600 bg-blue-50"
                  }`}>
                    {alert.severity}
                  </Badge>
                </div>
              ))}
              {(!alerts || alerts.length === 0) && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="h-8 w-8 text-emerald-400 mb-2" />
                  <p className="text-sm font-medium text-muted-foreground">No open alerts</p>
                  <p className="text-xs text-muted-foreground/60">Great work keeping compliant!</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="premium-card">
        <div className="p-6 border-b border-border/60 flex items-center justify-between">
          <h3 className="section-title">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Facilities
          </h3>
          <Link href="/app/facilities">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground -mr-2">
              View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        <div className="divide-y divide-border/60">
          {facilities?.slice(0, 5).map(facility => (
            <Link key={facility.id} href={`/app/facilities/${facility.id}`}>
              <div className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary/70" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{facility.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {facility.facilityType} {facility.licenseNumber ? `· ${facility.licenseNumber}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={`text-[10px] font-medium ${
                    facility.isActive
                      ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                      : "border-slate-200 text-slate-500 bg-slate-50"
                  }`}>
                    {facility.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                </div>
              </div>
            </Link>
          ))}
          {(!facilities || facilities.length === 0) && (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No facilities found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
