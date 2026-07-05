import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListMyFacilityAssignments } from "@/hooks/useFacilityAssignments";
import {
  buildFacilityRetrainingStatus,
  ORG_WIDE_VISIBILITY_ROLES,
} from "@/lib/facilityRetrainingStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Building2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Clock,
  HelpCircle,
} from "lucide-react";

export default function RetrainingMonitor() {
  const { user } = useAuth();
  const { data: facilities, isLoading: facilitiesLoading } = useListFacilities();
  const { data: employees, isLoading: employeesLoading } = useListEmployees();
  const { data: practicums, isLoading: practicumsLoading } = useListPracticums({
    year: new Date().getFullYear(),
  });

  const hasOrgWideVisibility = !user?.role || ORG_WIDE_VISIBILITY_ROLES.has(user.role);
  const { data: myAssignments, isLoading: assignmentsLoading } = useListMyFacilityAssignments(
    user?.id,
    !hasOrgWideVisibility
  );
  const assignedFacilityIds = useMemo(
    () => new Set((myAssignments ?? []).map((a) => a.facility_id)),
    [myAssignments]
  );

  const isLoading =
    facilitiesLoading ||
    employeesLoading ||
    practicumsLoading ||
    (!hasOrgWideVisibility && assignmentsLoading);

  const facilityStatuses = useMemo(
    () =>
      buildFacilityRetrainingStatus(facilities ?? [], employees ?? [], practicums ?? [], {
        role: user?.role ?? null,
        assignedFacilityIds,
      }),
    [facilities, employees, practicums, user?.role, assignedFacilityIds]
  );

  const totalFacilities = facilityStatuses.length;
  const compliantFacilities = facilityStatuses.filter(
    (f) => f.overallStatus === "compliant"
  ).length;
  const criticalFacilities = facilityStatuses.filter(
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
    unknown: {
      label: "Not Assigned",
      color: "text-muted-foreground",
      icon: HelpCircle,
      badgeVariant: "outline",
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
      ) : facilityStatuses.length === 0 ? (
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
          {facilityStatuses.map((fac) => {
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
                          {fac.facilityType?.replace(/_/g, " ")}
                          {fac.isVisible && (
                            <>
                              {" "}&middot; {fac.totalMedAdminStaff} med admin staff
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <Badge variant={config.badgeVariant}>
                      {config.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!fac.isVisible ? (
                    <p className="text-sm text-muted-foreground">
                      You are not assigned to this facility, so staff and practicum
                      records aren&apos;t visible here. This is not the same as being
                      verified compliant &mdash; ask an org admin or auditor to review it.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <Progress value={compliancePercent} className="flex-1 h-2" />
                        <span className="text-sm font-medium w-12 text-right">
                          {compliancePercent}%
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
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
                    </>
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
