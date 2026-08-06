import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "wouter";
import { formatDateForDisplay, facilityYear } from "@/lib/dateUtils";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListPracticums } from "@/hooks/usePracticums";
import { useListMyFacilityAssignments } from "@/hooks/useFacilityAssignments";
import { useEnrollRetrainingCohort, useListTrainingClasses } from "@/hooks/useTrainingClasses";
import {
  buildFacilityRetrainingStatus,
  ORG_WIDE_VISIBILITY_ROLES,
  summarizeEnrollmentResults,
  type FacilityRetrainingStatus,
  type RetrainingCandidate,
} from "@/lib/facilityRetrainingStatus";
import { facilityTypeLabel } from "@/lib/facilityTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Clock,
  HelpCircle,
  Users,
  CalendarPlus,
} from "lucide-react";

const reasonLabel: Record<string, string> = {
  missing: "Missing practicum",
  due_soon: "Due soon",
  expired: "Expired",
};

function EnrollCohortDialog({
  open,
  onOpenChange,
  facility,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facility: FacilityRetrainingStatus | null;
}) {
  const __fieldIds = useId();
  const { toast } = useToast();
  const enroll = useEnrollRetrainingCohort();
  const classes = useListTrainingClasses({
    facilityId: facility?.facilityId,
    enrollableOnly: true,
  });
  const [classId, setClassId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<
    Array<{ employeeId: string; success: boolean; status?: string; waitlistPosition?: number | null; error?: string }>
  >([]);

  const candidates = facility?.candidates ?? [];

  useEffect(() => {
    if (!open || !facility) return;
    setClassId("");
    setResults([]);
    setSelected(new Set(facility.candidates.map((c) => c.employeeId)));
  }, [open, facility]);

  const toggle = (employeeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const submit = async () => {
    if (!classId || selected.size === 0) return;
    try {
      const outcome = await enroll.mutateAsync({
        classId,
        employeeIds: [...selected],
      });
      setResults(outcome);
      const summary = summarizeEnrollmentResults(outcome);
      toast({
        title: "Cohort enrollment finished",
        description: `${summary.registered} registered · ${summary.waitlisted} waitlisted · ${summary.failed} failed`,
        variant: summary.failed > 0 ? "destructive" : "default",
      });
    } catch (error) {
      toast({
        title: "Enrollment blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const selectedClass = (classes.data ?? []).find((row) => row.id === classId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enroll retraining cohort</DialogTitle>
          <DialogDescription>
            {facility
              ? `Register ${facility.facilityName} med-admin staff who need practicum attention into a scheduled class. Capacity and waitlist rules apply automatically.`
              : "Select a facility first."}
          </DialogDescription>
        </DialogHeader>

        {!facility ? null : (
          <div className="space-y-4 py-2">
            <div className="space-y-2" role="group" aria-labelledby={`${__fieldIds}-scheduled-class`}>
              <Label id={`${__fieldIds}-scheduled-class`}>Scheduled class</Label>
              {classes.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading classes…</p>
              ) : classes.isError ? (
                <QueryError what="scheduled classes" error={classes.error} onRetry={() => void classes.refetch()} />
              ) : (classes.data ?? []).length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No scheduled or in-progress classes at this facility.{" "}
                  <Link href="/trainer/classes" className="text-primary underline-offset-2 hover:underline">
                    Create a class
                  </Link>{" "}
                  first, then return here to enroll the cohort.
                </div>
              ) : (
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger aria-label="Class">
                    <SelectValue placeholder="Choose a class" />
                  </SelectTrigger>
                  <SelectContent>
                    {(classes.data ?? []).map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.class_name} · {formatDateForDisplay(row.class_date)} · cap {row.capacity} · {row.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedClass && (
                <p className="text-xs text-muted-foreground">
                  {selectedClass.location || selectedClass.room_name || "Location TBD"} · {selectedClass.duration_hours}h
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium leading-none">Staff needing action ({candidates.length})</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(new Set(candidates.map((c) => c.employeeId)))}
                  >
                    Select all
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              </div>
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Everyone visible here is currently practicum-compliant.</p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {candidates.map((candidate: RetrainingCandidate) => (
                    <label
                      key={candidate.employeeId}
                      className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={selected.has(candidate.employeeId)}
                        onCheckedChange={() => toggle(candidate.employeeId)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {candidate.lastName}, {candidate.firstName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.jobTitle || "Staff"} · {reasonLabel[candidate.reason] ?? candidate.reason}
                          {candidate.dueDate
                            ? ` · due ${formatDateForDisplay(candidate.dueDate, { month: "short", day: "numeric", year: "numeric" })}`
                            : ""}
                        </p>
                      </div>
                      <Badge variant={candidate.reason === "expired" ? "destructive" : "secondary"}>
                        {reasonLabel[candidate.reason] ?? candidate.reason}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {results.length > 0 && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Enrollment results</p>
                {results.map((row) => (
                  <p key={row.employeeId} className={row.success ? "text-muted-foreground" : "text-destructive"}>
                    {candidates.find((c) => c.employeeId === row.employeeId)?.lastName ?? row.employeeId.slice(0, 8)}:{" "}
                    {row.success
                      ? `${row.status}${row.waitlistPosition != null ? ` (#${row.waitlistPosition})` : ""}`
                      : row.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!classId || selected.size === 0 || enroll.isPending}
            onClick={() => void submit()}
          >
            {enroll.isPending ? "Enrolling…" : `Enroll ${selected.size} staff`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RetrainingMonitor() {
  const { user } = useAuth();
  const facilitiesQuery = useListFacilities();
  // Only active med-admin staff -- matches what buildFacilityRetrainingStatus counts.
  const employeesQuery = useListEmployees({ status: "active", administersMedications: true });
  const practicumsQuery = useListPracticums({ year: facilityYear() });
  const { data: facilities, isLoading: facilitiesLoading } = facilitiesQuery;
  const { data: employees, isLoading: employeesLoading } = employeesQuery;
  const { data: practicums, isLoading: practicumsLoading } = practicumsQuery;
  // A failed fetch must not read as "No facilities found" or as a compliant
  // facility list computed from empty employees/practicums.
  const primaryQueries = [facilitiesQuery, employeesQuery, practicumsQuery];
  const primaryError = primaryQueries.find((query) => query.isError);

  const hasOrgWideVisibility = !user?.role || ORG_WIDE_VISIBILITY_ROLES.has(user.role);
  const { data: myAssignments, isLoading: assignmentsLoading } = useListMyFacilityAssignments(
    user?.id,
    !hasOrgWideVisibility,
  );
  const assignedFacilityIds = useMemo(
    () => new Set((myAssignments ?? []).map((a) => a.facility_id)),
    [myAssignments],
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
    [facilities, employees, practicums, user?.role, assignedFacilityIds],
  );

  const [enrollFacility, setEnrollFacility] = useState<FacilityRetrainingStatus | null>(null);

  const totalFacilities = facilityStatuses.length;
  const compliantFacilities = facilityStatuses.filter((f) => f.overallStatus === "compliant").length;
  const criticalFacilities = facilityStatuses.filter(
    (f) => f.overallStatus === "critical" || f.overallStatus === "expired",
  ).length;
  const totalCandidates = facilityStatuses.reduce((sum, f) => sum + f.candidates.length, 0);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Retraining Monitor</h1>
          <p className="text-muted-foreground">
            Track medication administration training compliance and enroll due cohorts into scheduled classes.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/trainer/classes">
            <CalendarPlus className="mr-2 h-4 w-4" /> Classes
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Building2 className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalFacilities}</p>
              <p className="text-sm text-muted-foreground">Total Facilities</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <ShieldCheck className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{compliantFacilities}</p>
              <p className="text-sm text-muted-foreground">Fully Compliant</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-2xl font-bold">{criticalFacilities}</p>
              <p className="text-sm text-muted-foreground">Need Attention</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalCandidates}</p>
              <p className="text-sm text-muted-foreground">Staff to enroll</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {primaryError ? (
        <QueryError
          what="retraining compliance"
          error={primaryError.error}
          onRetry={() => primaryQueries.forEach((query) => void query.refetch())}
        />
      ) : isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : facilityStatuses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="mb-1 text-lg font-semibold">No facilities found</h3>
            <p className="text-sm text-muted-foreground">No facilities are available for retraining monitoring.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {facilityStatuses.map((fac) => {
            const config = statusConfig[fac.overallStatus] ?? statusConfig.compliant;
            const StatusIcon = config.icon;
            const totalRecords =
              fac.compliantCount + fac.dueSoonCount + fac.expiredCount + fac.missingCount;
            const compliancePercent =
              totalRecords > 0
                ? Math.round((fac.compliantCount / totalRecords) * 100)
                : fac.totalMedAdminStaff === 0
                  ? 100
                  : 0;

            return (
              <Card key={fac.facilityId}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg bg-muted ${config.color}`}
                      >
                        <StatusIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{fac.facilityName}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {facilityTypeLabel(fac.facilityType)}
                          {fac.isVisible && (
                            <>
                              {" "}
                              &middot; {fac.totalMedAdminStaff} med admin staff
                              {fac.candidates.length > 0 ? ` · ${fac.candidates.length} need action` : ""}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={config.badgeVariant}>{config.label}</Badge>
                      {fac.isVisible && fac.candidates.length > 0 && (
                        <Button size="sm" onClick={() => setEnrollFacility(fac)}>
                          <Users className="mr-2 h-4 w-4" /> Enroll cohort
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!fac.isVisible ? (
                    <p className="text-sm text-muted-foreground">
                      You are not assigned to this facility, so staff and practicum records aren't visible
                      here. This is not the same as being verified compliant &mdash; ask an org admin or auditor
                      to review it.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <Progress value={compliancePercent} className="h-2 flex-1" />
                        <span className="w-12 text-right text-sm font-medium">{compliancePercent}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
                        <div className="rounded-lg bg-green-50 py-2">
                          <p className="text-lg font-bold text-green-700">{fac.compliantCount}</p>
                          <p className="text-xs text-muted-foreground">Compliant</p>
                        </div>
                        <div className="rounded-lg bg-yellow-50 py-2">
                          <p className="text-lg font-bold text-yellow-700">{fac.dueSoonCount}</p>
                          <p className="text-xs text-muted-foreground">Due Soon</p>
                        </div>
                        <div className="rounded-lg bg-red-50 py-2">
                          <p className="text-lg font-bold text-red-700">{fac.expiredCount}</p>
                          <p className="text-xs text-muted-foreground">Expired</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 py-2">
                          <p className="text-lg font-bold text-gray-700">{fac.missingCount}</p>
                          <p className="text-xs text-muted-foreground">Missing</p>
                        </div>
                      </div>
                      {fac.nextExpiryDate && (
                        <p className="text-xs text-muted-foreground">
                          Next expiry:{" "}
                          {formatDateForDisplay(fac.nextExpiryDate, {
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

      <EnrollCohortDialog
        open={Boolean(enrollFacility)}
        onOpenChange={(open) => !open && setEnrollFacility(null)}
        facility={enrollFacility}
      />
    </div>
  );
}
