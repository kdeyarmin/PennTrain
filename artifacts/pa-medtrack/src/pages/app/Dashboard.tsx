import { useGetDashboardSummary, useListAlerts, useListFacilities, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Building2, Users, AlertTriangle, CheckCircle, Clock, XCircle, AlertCircle, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";

export default function OrgDashboard() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({});
  const { data: alerts } = useListAlerts({ status: "open" });
  const { data: facilities } = useListFacilities({});
  const logoutMutation = useLogout({});

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Compliance Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {user?.firstName}. Here's your organization's compliance overview.
          </p>
        </div>
      </div>

      {criticalAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-800">
              {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? "s" : ""} Require Attention
            </p>
            <p className="text-sm text-red-700 mt-1">{criticalAlerts[0]?.title}</p>
          </div>
          <Link href="/app/alerts">
            <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-100">
              View Alerts
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-2xl font-bold text-green-700">{summaryLoading ? "—" : summary?.compliantCount ?? 0}</span>
              </div>
              <p className="text-sm text-muted-foreground">Compliant</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-yellow-600" />
                <span className="text-2xl font-bold text-yellow-700">{summaryLoading ? "—" : summary?.dueSoon30Count ?? 0}</span>
              </div>
              <p className="text-sm text-muted-foreground">Due Soon</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <span className="text-2xl font-bold text-red-700">{summaryLoading ? "—" : summary?.expiredCount ?? 0}</span>
              </div>
              <p className="text-sm text-muted-foreground">Expired</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-gray-500" />
                <span className="text-2xl font-bold text-gray-700">{summaryLoading ? "—" : summary?.missingDocumentCount ?? 0}</span>
              </div>
              <p className="text-sm text-muted-foreground">Missing</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Overall Compliance Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <span className="text-5xl font-bold text-primary">{summary?.compliancePercentage ?? 100}%</span>
              <span className="text-muted-foreground mb-1">of training records compliant</span>
            </div>
            <Progress value={summary?.compliancePercentage ?? 100} className="h-3" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{summary?.totalEmployees ?? 0} Active Staff</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span>{summary?.openAlertsCount ?? 0} Open Alerts</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <span>{summary?.totalMedAdminStaff ?? 0} Med Admin Staff</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Alerts</CardTitle>
            <Link href="/app/alerts">
              <Button variant="ghost" size="sm">View All <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alerts?.slice(0, 5).map(alert => (
                <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <div className={`h-2 w-2 rounded-full mt-2 shrink-0 ${alert.severity === "critical" ? "bg-red-500" : alert.severity === "warning" ? "bg-yellow-500" : "bg-blue-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                  </div>
                </div>
              ))}
              {(!alerts || alerts.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No open alerts. Great work!</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Facilities</CardTitle>
          <Link href="/app/facilities">
            <Button variant="ghost" size="sm">View All <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {facilities?.slice(0, 5).map(facility => (
              <Link key={facility.id} href={`/app/facilities/${facility.id}`}>
                <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 border transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{facility.name}</p>
                      <p className="text-xs text-muted-foreground">{facility.facilityType} — License: {facility.licenseNumber ?? "N/A"}</p>
                    </div>
                  </div>
                  <Badge variant="outline">{facility.isActive ? "Active" : "Inactive"}</Badge>
                </div>
              </Link>
            ))}
            {(!facilities || facilities.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">No facilities found.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
