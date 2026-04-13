import { useGetDashboardSummary, useListAlerts, useListFacilities, useGetComplianceByFacility } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Users, AlertTriangle, CheckCircle, Clock, XCircle, AlertCircle, ChevronRight, TrendingUp, Shield, Activity, UserPlus, FileText, LayoutGrid, Bell } from "lucide-react";
import { Link } from "wouter";

function DonutChart({ percentage, size = 140, strokeWidth = 12 }: { percentage: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = percentage >= 90 ? "#10b981" : percentage >= 75 ? "#f59e0b" : "#ef4444";
  const bgColor = percentage >= 90 ? "#d1fae5" : percentage >= 75 ? "#fef3c7" : "#fee2e2";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tighter" style={{ color }}>{percentage}%</span>
        <span className="text-[10px] text-muted-foreground font-medium">Compliant</span>
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-8 w-14" />
        </div>
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
      <div className="mt-3">
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export default function OrgDashboard() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({});
  const { data: alerts } = useListAlerts({ status: "open" });
  const { data: facilities } = useListFacilities({});
  const { data: facilityCompliance } = useGetComplianceByFacility({});

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];
  const compliancePct = summary?.compliancePercentage ?? 100;

  const complianceColor = compliancePct >= 90 ? "text-emerald-600" : compliancePct >= 75 ? "text-amber-600" : "text-red-600";

  const totalRecords = (summary?.compliantCount ?? 0) + (summary?.dueSoon30Count ?? 0) + (summary?.expiredCount ?? 0);
  const dueSoonPct = totalRecords > 0 ? Math.round(((summary?.dueSoon30Count ?? 0) / totalRecords) * 100) : 0;
  const expiredPct = totalRecords > 0 ? Math.round(((summary?.expiredCount ?? 0) / totalRecords) * 100) : 0;

  const facilityComplianceMap = new Map(
    (facilityCompliance ?? []).map(fc => [fc.facilityId, fc])
  );

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

      {summaryLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="stat-label">Compliant</p>
                <p className="stat-value text-emerald-600">{summary?.compliantCount ?? 0}</p>
              </div>
              <div className="stat-icon bg-emerald-50">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>of {totalRecords} records</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="stat-label">Due Soon</p>
                <p className="stat-value text-amber-600">{summary?.dueSoon30Count ?? 0}</p>
              </div>
              <div className="stat-icon bg-amber-50">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 font-medium">
              <Activity className="h-3.5 w-3.5" />
              <span>{dueSoonPct}% of records</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="stat-label">Expired</p>
                <p className="stat-value text-red-600">{summary?.expiredCount ?? 0}</p>
              </div>
              <div className="stat-icon bg-red-50">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{expiredPct}% of records</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="stat-label">Missing Docs</p>
                <p className="stat-value text-slate-600">{summary?.missingDocumentCount ?? 0}</p>
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
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/app/employees?action=add">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <UserPlus className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Add Employee</span>
          </div>
        </Link>
        <Link href="/app/reports">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <FileText className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Run Report</span>
          </div>
        </Link>
        <Link href="/app/training-matrix">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <LayoutGrid className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">View Matrix</span>
          </div>
        </Link>
        <Link href="/app/alerts">
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 hover:border-primary/20 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center group-hover:bg-primary/12 transition-colors">
              <Bell className="h-5 w-5 text-primary/70" />
            </div>
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Manage Alerts</span>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 premium-card">
          <div className="p-6 border-b border-border/60">
            <h3 className="section-title">Overall Compliance Score</h3>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-8">
              {summaryLoading ? (
                <Skeleton className="h-[140px] w-[140px] rounded-full" />
              ) : (
                <DonutChart percentage={compliancePct} />
              )}
              <div className="flex-1">
                <p className={`text-lg font-semibold ${complianceColor}`}>
                  {compliancePct >= 90 ? "Excellent" : compliancePct >= 75 ? "Needs Improvement" : "At Risk"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">of training records compliant</p>
              </div>
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
          {facilities?.slice(0, 5).map(facility => {
            const fc = facilityComplianceMap.get(facility.id);
            const score = fc?.complianceScore ?? 0;
            const dotColor = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";
            const barColor = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-amber-500" : "bg-red-500";

            return (
              <Link key={facility.id} href={`/app/facilities/${facility.id}`}>
                <div className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary/70" />
                      </div>
                      <div className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${dotColor}`} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold">{facility.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {facility.facilityType} {facility.licenseNumber ? `· ${facility.licenseNumber}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {fc && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground w-8 text-right">{score}%</span>
                      </div>
                    )}
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
            );
          })}
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
