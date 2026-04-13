import { useGetFacilitiesRetrainingStatus } from "@workspace/api-client-react";
import type { FacilityRetrainingStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Building2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Clock,
} from "lucide-react";

export default function RetrainingMonitor() {
  const { data, isLoading } = useGetFacilitiesRetrainingStatus();

  const facilities = (data ?? []) as FacilityRetrainingStatus[];

  const totalFacilities = facilities.length;
  const compliantFacilities = facilities.filter(
    (f) => f.overallStatus === "compliant"
  ).length;
  const criticalFacilities = facilities.filter(
    (f) => f.overallStatus === "critical" || f.overallStatus === "expired"
  ).length;

  const statusConfig: Record<
    string,
    { label: string; color: string; icon: typeof ShieldCheck; badgeVariant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    compliant: {
      label: "Compliant",
      color: "text-green-600",
      icon: ShieldCheck,
      badgeVariant: "default",
    },
    due_soon: {
      label: "Due Soon",
      color: "text-yellow-600",
      icon: Clock,
      badgeVariant: "secondary",
    },
    expired: {
      label: "Expired",
      color: "text-orange-600",
      icon: AlertTriangle,
      badgeVariant: "destructive",
    },
    critical: {
      label: "Critical",
      color: "text-red-600",
      icon: XCircle,
      badgeVariant: "destructive",
    },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Retraining Monitor
        </h1>
        <p className="text-muted-foreground">
          Track medication administration training compliance across facilities.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalFacilities}</p>
              <p className="text-sm text-muted-foreground">Total Facilities</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{compliantFacilities}</p>
              <p className="text-sm text-muted-foreground">Fully Compliant</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-2xl font-bold">{criticalFacilities}</p>
              <p className="text-sm text-muted-foreground">
                Need Attention
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : facilities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No facilities found</h3>
            <p className="text-muted-foreground text-sm">
              No facilities are available for retraining monitoring.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {facilities.map((fac) => {
            const config = statusConfig[fac.overallStatus] ?? statusConfig.compliant;
            const StatusIcon = config.icon;
            const totalRecords =
              fac.compliantCount +
              fac.dueSoonCount +
              fac.expiredCount +
              fac.missingCount;
            const compliancePercent =
              totalRecords > 0
                ? Math.round((fac.compliantCount / totalRecords) * 100)
                : fac.totalMedAdminStaff === 0
                  ? 100
                  : 0;

            return (
              <Card key={fac.facilityId}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center ${config.color}`}
                      >
                        <StatusIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {fac.facilityName}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground capitalize">
                          {fac.facilityType?.replace(/_/g, " ")} &middot;{" "}
                          {fac.totalMedAdminStaff} med admin staff
                        </p>
                      </div>
                    </div>
                    <Badge variant={config.badgeVariant}>
                      {config.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Progress value={compliancePercent} className="flex-1 h-2" />
                    <span className="text-sm font-medium w-12 text-right">
                      {compliancePercent}%
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-center text-sm">
                    <div className="rounded-lg bg-green-50 dark:bg-green-950/20 py-2">
                      <p className="text-lg font-bold text-green-700 dark:text-green-400">
                        {fac.compliantCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Compliant</p>
                    </div>
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 py-2">
                      <p className="text-lg font-bold text-yellow-700 dark:text-yellow-400">
                        {fac.dueSoonCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Due Soon</p>
                    </div>
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/20 py-2">
                      <p className="text-lg font-bold text-red-700 dark:text-red-400">
                        {fac.expiredCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Expired</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-950/20 py-2">
                      <p className="text-lg font-bold text-gray-700 dark:text-gray-400">
                        {fac.missingCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Missing</p>
                    </div>
                  </div>
                  {fac.nextExpiryDate && (
                    <p className="text-xs text-muted-foreground">
                      Next expiry:{" "}
                      {new Date(fac.nextExpiryDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
